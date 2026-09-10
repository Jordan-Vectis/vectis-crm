import { prisma } from "@/lib/prisma"
import { MIGRATIONS_HASH } from "@/lib/migrations"
import { STAGE_LABEL } from "@/lib/pipeline-queue"
import type { CheckResult, Fact, StatusCheckDef } from "../types"

// 🚦 The Hub itself — its own server on Railway.
//
// If this check runs at all, the Hub is up: it runs inside the Hub. So the light is about what can
// be wrong WHILE it is up — a database update waiting for Run Migrations, the overnight AI queue
// stalled, background jobs switched off on production — plus the facts an admin needs to explain a
// fault: how long since the last restart (a deploy or a crash), which version is running, and how
// many pages are connected for live updates.
//
// ⚠ A green Hub says nothing about whether SAVING works. On 2026-09-09 Railway looked perfectly
// healthy throughout while ~1 in 4 saves failed. That is the Database light's job, not this one.
//
// ⚠ Read in-process only (globalThis, set by server.js). Never self-connect a socket.io client to
// count connections: every disconnect broadcasts bidder counts to every connected iPad
// (lib/auction-socket.js). And never call the pipeline route from here — it spends AI quota.

/** How long a RUNNING sale may go without a heartbeat before it counts as stalled.
 *  ⚠ NOT the runner's HEARTBEAT_STALE_MS (3 min). The runner writes heartbeatAt once per LOT, and one
 *  lot can keep retrying inside a slice — Gemini errors are retried in-process every 12–30 s until the
 *  9-minute slice deadline (lib/pipeline-runner.ts withRetry, SLICE_MS), and a call already in flight
 *  then can run on to the batch route's 300 s. So up to ~14 minutes of quiet is an AI supplier
 *  struggling, not the Hub's loop dying — judging it sooner would answer "is it us or a supplier?"
 *  the wrong way round. */
const RUNNING_QUIET_MS = 15 * 60 * 1000
/** A sale that is free to run should be picked up within a tick or two (the loop ticks every 30 s). */
const QUEUE_PICKUP_MS = 3 * 60 * 1000
/** ⚠ A read that hangs (a wedged database) must not run into the engine's 25-second cap: that throws
 *  away every fact here, and the restart time and version are what an admin needs on a bad database
 *  day. Past this the read counts as "couldn't read". Two reads in turn: 8 + 8 s. */
const DB_DEADLINE_MS = 8_000

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error("timed out")), ms) })
  return Promise.race([p, late]).finally(() => clearTimeout(t))
}
/** The pipeline loop's first tick is 60 s after boot; give it room before judging the queue, or every
 *  deploy that interrupts a sale would read as a stall. */
const BOOT_SETTLE_MS = 3 * 60 * 1000
/** A restart this recent is worth pointing out — it explains "it went funny ten minutes ago". */
const RECENT_RESTART_MS = 30 * 60 * 1000

function fmtWhen(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms))
}

function fmtAgo(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 1) return "less than a minute"
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`
  return `${Math.round(h / 24)} days`
}

const isMissingTable = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null
  return err?.code === "P2021" || err?.code === "P2022" || /does not exist in the current database|relation .* does not exist/i.test(String(err?.message ?? ""))
}

type QueueRow = {
  code: string; status: string; stage: string; done: number; total: number
  heartbeatAt: Date | null; retryAfter: Date | null; updatedAt: Date
}

const check: StatusCheckDef = {
  key: "hub",
  name: "The Hub",
  group: "hub",
  what: "The Hub's own server on Railway.",
  whenDown: "Nobody can open any page — and this page can't tell you, because it runs on the Hub.",
  statusPage: "https://status.railway.com",
  intervalMin: 5,

  async run(ctx): Promise<CheckResult> {
    const g = globalThis as unknown as { _bootedAt?: number; _io?: { engine?: { clientsCount?: number } } }
    const nowMs = ctx.now.getTime()
    const problems: string[] = []
    let unreadable = false
    const facts: Fact[] = [{ label: "Environment", value: ctx.env }]

    // ── Running since ────────────────────────────────────────────────────────────
    // server.js stamps _bootedAt when it starts listening. Under `next dev` there is no server.js,
    // so fall back to the process's own age for the settle-time maths below.
    const bootedAt = typeof g._bootedAt === "number" ? g._bootedAt : null
    const upMs = bootedAt != null ? nowMs - bootedAt : process.uptime() * 1000
    const recentlyRestarted = upMs < RECENT_RESTART_MS
    if (bootedAt != null) {
      facts.push(recentlyRestarted
        ? { label: "Running since", value: `${fmtWhen(bootedAt)} — restarted ${fmtAgo(upMs)} ago (a deploy or a crash)`, tone: "warn" }
        : { label: "Running since", value: `${fmtWhen(bootedAt)} (${fmtAgo(upMs)})` })
    } else {
      facts.push({ label: "Running since", value: "Not known — started without server.js (a development server)" })
    }

    // ── Version ──────────────────────────────────────────────────────────────────
    const sha = process.env.RAILWAY_GIT_COMMIT_SHA
    const message = (process.env.RAILWAY_GIT_COMMIT_MESSAGE ?? "").split(/\r?\n/)[0].trim()
    facts.push({
      label: "Version",
      value: sha
        ? `${sha.slice(0, 7)}${message ? ` — ${message.length > 90 ? `${message.slice(0, 89)}…` : message}` : ""}`
        : "Not a Railway build",
    })

    // ── Background jobs ──────────────────────────────────────────────────────────
    // ⚠ Whether the secret is SET, never its value.
    if (ctx.backgroundJobsExpected) {
      facts.push({ label: "Background jobs", value: "Run here — warehouse sync, backups, mailbox checks and the overnight AI queue", tone: "good" })
    } else if (ctx.isProduction) {
      // Every loop in server.js silently does nothing without CRON_SECRET, so on production that is
      // a real fault — and one that looks exactly like a quiet night.
      problems.push("background jobs aren't running on production")
      facts.push({ label: "Background jobs", value: "Not running — the warehouse sync, backups, mailbox checks and overnight AI queue are all switched off", tone: "bad" })
    } else {
      facts.push({ label: "Background jobs", value: "Off here, by design — only production runs them" })
    }

    // ── Live connections ─────────────────────────────────────────────────────────
    const clients = g._io?.engine?.clientsCount
    facts.push(typeof clients === "number"
      ? { label: "Live connections", value: `${clients.toLocaleString("en-GB")} open page${clients === 1 ? "" : "s"} connected for live updates` }
      : { label: "Live connections", value: "Live updates aren't running here (started without server.js)" })

    // ── Overnight AI queue ───────────────────────────────────────────────────────
    // ⚠ Only judged where the loop actually runs. Elsewhere a queued sale sits QUEUED for ever by
    // design, and staging/sandbox hold production's queue as it was the day they were copied.
    if (!ctx.backgroundJobsExpected) {
      facts.push({ label: "Overnight AI queue", value: "Doesn't run here" })
    } else {
      let rows: QueueRow[] | null = null
      // When anything else in the queue last changed (a sale finishing, being held or cancelled).
      let settledAt = 0
      try {
        const [active, other] = await withDeadline(Promise.all([
          prisma.pipelineQueueItem.findMany({
            where: { status: { in: ["RUNNING", "QUEUED"] } },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            select: { code: true, status: true, stage: true, done: true, total: true, heartbeatAt: true, retryAfter: true, updatedAt: true },
          }),
          prisma.pipelineQueueItem.aggregate({ where: { status: { notIn: ["RUNNING", "QUEUED"] } }, _max: { updatedAt: true } }),
        ]), DB_DEADLINE_MS)
        rows = active
        settledAt = other._max.updatedAt?.getTime() ?? 0
      } catch (e) {
        if (isMissingTable(e)) facts.push({ label: "Overnight AI queue", value: "Not set up yet on this environment (Run Migrations)" })
        else { unreadable = true; facts.push({ label: "Overnight AI queue", value: "Couldn't read it", tone: "warn" }) }
      }
      if (rows) {
        const running = rows.find(r => r.status === "RUNNING")
        const queued = rows.filter(r => r.status === "QUEUED")
        const settling = upMs < BOOT_SETTLE_MS
        const more = queued.length ? ` · ${queued.length} more sale${queued.length === 1 ? "" : "s"} waiting` : ""

        if (!running && !queued.length) {
          facts.push({ label: "Overnight AI queue", value: "Idle — nothing queued" })
        } else if (running) {
          const beat = (running.heartbeatAt ?? running.updatedAt).getTime()
          const quietMs = nowMs - beat
          const progress = `${running.done.toLocaleString("en-GB")} of ${running.total.toLocaleString("en-GB")} lots, ${STAGE_LABEL[running.stage] ?? running.stage}`
          if (quietMs > RUNNING_QUIET_MS && !settling) {
            problems.push(`the overnight AI queue has stalled on ${running.code}`)
            facts.push({ label: "Overnight AI queue", value: `Stalled — ${running.code} (${progress}) hasn't shown a sign of life for ${fmtAgo(quietMs)}${more}`, tone: "bad" })
          } else {
            facts.push({ label: "Overnight AI queue", value: `Running ${running.code} — ${progress}, last sign of life ${fmtAgo(quietMs)} ago${more}` })
          }
        } else {
          // Nothing running. A sale free to go should be claimed within a tick or two; one still
          // backing off (retryAfter in the future) is waiting on purpose.
          const ready = queued.filter(r => !r.retryAfter || r.retryAfter.getTime() <= nowMs)
          // ⚠ "Free since" = the later of when its backoff ended and when ANYTHING in the queue last
          // moved. Its own updatedAt alone is wrong: a sale queued at 6 pm still carries that time when
          // the one ahead of it finishes (or ends a 9-minute slice) at 2 am, so the ≤30 s until the
          // next tick claims it would read as "ready for 8 hours, nothing picking it up" — a false
          // amber at every hand-over. (A sale REMOVED mid-slice leaves no row to date it from; that
          // gap is one tick, and a single check never rings the bell.)
          const lastMoved = Math.max(settledAt, ...rows.map(r => r.updatedAt.getTime()))
          const freeSince = (r: QueueRow) => Math.max(lastMoved, r.retryAfter?.getTime() ?? 0)
          const stuck = ready.filter(r => nowMs - freeSince(r) > QUEUE_PICKUP_MS)
          if (stuck.length && !settling) {
            const first = stuck[0]
            problems.push(`the overnight AI queue isn't picking up ${first.code}`)
            facts.push({ label: "Overnight AI queue", value: `Stalled — ${first.code} is ready to run, but nothing in the queue has moved for ${fmtAgo(nowMs - freeSince(first))}`, tone: "bad" })
          } else if (!ready.length) {
            const next = queued.reduce((a, b) => ((a.retryAfter?.getTime() ?? 0) <= (b.retryAfter?.getTime() ?? 0) ? a : b))
            facts.push({ label: "Overnight AI queue", value: `${queued.length} sale${queued.length === 1 ? "" : "s"} waiting — pausing until ${fmtWhen(next.retryAfter!.getTime())} because the AI asked the Hub to slow down` })
          } else {
            facts.push({ label: "Overnight AI queue", value: `${queued.length} sale${queued.length === 1 ? "" : "s"} waiting — ${ready[0].code} is next` })
          }
        }
        if (settling && (running || queued.length)) {
          facts.push({ label: "Note", value: "The Hub has only just restarted — the queue is picked back up within a minute or two, so it isn't judged yet." })
        }
      }
    }

    // ── Database update waiting ──────────────────────────────────────────────────
    // Same comparison as GET /api/admin/run-migrations: the fingerprint of the MIGRATIONS array at the
    // last clean Run Migrations, against this deploy's. ⚠ A missing MigrationState table means nothing
    // has ever been run here → waiting (as the admin banner treats it), not "couldn't read".
    try {
      const row = await withDeadline(prisma.migrationState.findUnique({ where: { id: "current" }, select: { hash: true, ranAt: true } }), DB_DEADLINE_MS)
      if (!row || row.hash !== MIGRATIONS_HASH) {
        problems.push("a database update is waiting")
        facts.push({ label: "Database update", value: "Waiting — press Run Migrations on the Admin page", tone: "warn" })
      } else {
        facts.push({ label: "Database update", value: `Up to date — last run ${fmtWhen(row.ranAt.getTime())}`, tone: "good" })
      }
    } catch (e) {
      if (isMissingTable(e)) {
        problems.push("a database update is waiting")
        facts.push({ label: "Database update", value: "Waiting — press Run Migrations on the Admin page", tone: "warn" })
      } else {
        unreadable = true
        facts.push({ label: "Database update", value: "Couldn't read whether one is waiting", tone: "warn" })
      }
    }

    // ── The light ────────────────────────────────────────────────────────────────
    if (problems.length) {
      const only = problems.length === 1 ? problems[0] : null
      const summary =
        only === "a database update is waiting" ? "A database update is waiting — press Run Migrations on the Admin page."
        : only ? `${only.charAt(0).toUpperCase()}${only.slice(1)}.`
        : `${problems.length} problems: ${problems.slice(0, -1).join(", ")} and ${problems[problems.length - 1]}.`
      return { state: "degraded", summary, facts }
    }
    if (unreadable) {
      return { state: "unknown", summary: "The Hub is running, but couldn't read the database to finish this check.", facts }
    }
    return {
      state: "ok",
      summary: bootedAt == null
        ? `Running on ${ctx.env} (a development server, without live updates or background jobs).`
        : recentlyRestarted
          ? `Running on ${ctx.env} — restarted ${fmtAgo(upMs)} ago.`
          : `Running normally on ${ctx.env} — up ${fmtAgo(upMs)}.`,
      facts,
    }
  },
}

export default check
