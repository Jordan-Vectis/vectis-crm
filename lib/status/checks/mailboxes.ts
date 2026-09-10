import { prisma } from "@/lib/prisma"
import type { CheckResult, Fact, StatusCheckDef, StatusState } from "@/lib/status/types"

// 📬 Microsoft mailbox links — the two optional Microsoft Graph polls that read a
// shared inbox directly: IT@ → Job Board (lib/it-mailbox.ts) and the condition-report
// inbox → Condition Reports (lib/condition-mailbox.ts). A background job in server.js
// runs each one every 5 minutes.
//
// Normally neither is connected. Microsoft asks for an administrator's approval even
// for one person's own sign-in, and that approval was refused, so IT emails come in
// through Make.com instead (the "IT emails → Job Board" light). With no connection this
// light is "off" (Not in use), never red — no connection is the normal state.
//
// ⚠ No Graph calls, and NEVER call getITMailboxToken / getConditionMailboxToken,
// syncITMailbox / syncConditionMailbox, or listConditionMailboxFolders from here. The
// token getters can refresh the token (a WRITE to the auth row, competing with the
// 5-minute job), the syncs create real jobs and reports, and a condition sync can spend
// Gemini quota. The job already does a real Graph read every 5 minutes and stamps
// lastSyncAt only after it has worked, so lastSyncAt is the whole signal.
//
// ⚠ Environment check FIRST (mail research, reviewer's version). Staging and sandbox
// databases are branches of production, so they can hold a copied auth row whose
// lastSyncAt stopped moving the day the branch was made. Where the background jobs don't
// run, "stale" means nothing — it's "off", not red.
//
// ⚠ Check the GRAPH_* settings before judging a stale lastSyncAt. Without them the token
// getter returns null before it even looks at the row, the poll reports "Mailbox not
// connected", and a red that blamed an expired sign-in would send someone the wrong way.
//
// ⚠ A fresh lastSyncAt proves one poll worked — Graph read and a database write — not that
// every email was saved, and it is not a database health signal: on 2026-09-09 some saves
// worked while ~1 in 4 were refused. (A message whose save failed is picked up again on
// the next poll, because the dedupe runs before the create.)

/** Three missed 5-minute polls. */
const FRESH_MS = 15 * 60_000
/** After a restart the first poll runs at +90 s / +100 s (server.js); give it time. */
const BOOT_GRACE_MS = 10 * 60_000

const GRAPH_VARS = ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"] as const

const RANK: Record<StatusState, number> = { off: 0, ok: 1, unknown: 2, degraded: 3, down: 4 }

const londonWhenFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
})

function durationText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return "less than a minute"
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"}`
  return `${Math.floor(h / 24)} days`
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

type AuthRow = { connectedBy: string | null; lastSyncAt: Date | null; updatedAt: Date; folderName?: string | null }
type Read = { row: AuthRow | null; error?: undefined } | { row?: undefined; error: string }

/** One mailbox's verdict. "unused" = not connected (or connected with no address), so it can't count against the light.
 *  `cause` is set on a red whose fix is ours (see CheckResult.cause) and carried onto the light by the worst verdict. */
type Verdict = { state: StatusState | "unused"; line: string; fact: Fact; cause?: "hub" }

function judge(opts: {
  name: string
  label: string
  read: Read
  /** The condition poll does nothing until CONDITION_MAILBOX is set; the IT one defaults its address. */
  address: string
  missingGraph: string[]
  reconnect: string
  now: number
  bootedAt: number | null
}): Verdict {
  const { name, label, read, address, missingGraph, reconnect, now, bootedAt } = opts

  if (read.error !== undefined) {
    return {
      state: "unknown",
      line: `couldn't read the ${name} connection from the database`,
      fact: { label, value: `Couldn't read: ${read.error}`, tone: "warn" },
    }
  }
  const row = read.row
  if (!row) return { state: "unused", line: "", fact: { label, value: "Not connected" } }

  const by = row.connectedBy ? `Connected by ${row.connectedBy}` : "Connected"

  // ⚠ syncConditionMailbox returns before stamping lastSyncAt when there's no address, so a
  // connected row with no address is simply not in use — never stale.
  if (!address) {
    return { state: "unused", line: "", fact: { label, value: `${by}, but no inbox address is set (CONDITION_MAILBOX), so it isn't being read` } }
  }

  // cause "hub": the settings are missing from OUR server — nothing Microsoft can fix.
  if (missingGraph.length) {
    return {
      state: "down",
      cause: "hub",
      line: `the ${name} is connected but this server is missing its Microsoft sign-in settings (${missingGraph.join(", ")}), so it can't be read`,
      fact: { label, value: `${by} · can't be read: Microsoft sign-in settings missing`, tone: "bad" },
    }
  }

  const folder = row.folderName ? ` · reading "${row.folderName}"` : ""
  const lastRead = row.lastSyncAt ? `last read ${londonWhenFmt.format(row.lastSyncAt)}` : "never read yet"

  if (row.lastSyncAt && now - row.lastSyncAt.getTime() < FRESH_MS) {
    return {
      state: "ok",
      line: `the ${name} was read ${durationText(now - row.lastSyncAt.getTime())} ago`,
      fact: { label, value: `${by} · ${lastRead}${folder}`, tone: "good" },
    }
  }

  // Grey, not red, while the polls haven't had a fair chance: just after a restart, or just
  // after someone connected it (updatedAt is the connect time while it has never been read).
  if (bootedAt !== null && now - bootedAt < BOOT_GRACE_MS) {
    return {
      state: "unknown",
      line: `the Hub restarted ${durationText(now - bootedAt)} ago and the ${name} hasn't been read since — waiting for the next poll`,
      fact: { label, value: `${by} · ${lastRead}${folder} · waiting for the first poll since the restart`, tone: "warn" },
    }
  }
  if (!row.lastSyncAt && now - row.updatedAt.getTime() < FRESH_MS) {
    return {
      state: "unknown",
      line: `the ${name} was connected a few minutes ago and is waiting for its first read`,
      fact: { label, value: `${by} · waiting for its first read${folder}`, tone: "warn" },
    }
  }

  const since = row.lastSyncAt ? `hasn't been read for ${durationText(now - row.lastSyncAt.getTime())}` : "has never been read successfully"
  // cause "hub": the usual fix is a person reconnecting their Microsoft sign-in. A real
  // Microsoft outage would look the same here, but the headline says sign-in, so this follows it.
  return {
    state: "down",
    cause: "hub",
    line: `the ${name} is connected but ${since} — usually the Microsoft sign-in has expired, and reconnecting it fixes it`,
    fact: { label, value: `${by} · ${lastRead}${folder} · reconnect: ${reconnect}`, tone: "bad" },
  }
}

async function readRow(query: () => Promise<AuthRow | null>): Promise<Read> {
  try {
    return { row: await query() }
  } catch (e) {
    // Prisma errors open with several lines of "Invalid `prisma.x()` invocation"; the reason is the last line.
    const lines = String((e as Error)?.message ?? e).split("\n").map(l => l.trim()).filter(Boolean)
    return { error: (lines[lines.length - 1] ?? "Unknown error").slice(0, 160) }
  }
}

const mailboxes: StatusCheckDef = {
  key: "mailboxes",
  name: "Microsoft mailbox links",
  group: "email",
  what: "Optional direct links for reading the IT and condition-report inboxes (they need Microsoft admin approval).",
  whenDown: "Only matters if one has been connected.",
  intervalMin: 15,

  async run(ctx): Promise<CheckResult> {
    const optionalFact: Fact = {
      label: "Why these are optional",
      value: "Microsoft asks for an administrator's approval before the Hub can read a mailbox itself. IT emails reach the Job Board through Make.com instead (see IT emails → Job Board).",
    }

    if (!ctx.backgroundJobsExpected) {
      return {
        state: "off",
        summary: "Background jobs don't run in this environment, so the mailbox links are off here.",
        facts: [
          { label: "This environment", value: ctx.env },
          { label: "Why it's off", value: "Both mailboxes are read by a background job that doesn't run here. This database is a copy, so any \"last read\" time in it stopped moving when the copy was made." },
          optionalFact,
        ],
      }
    }

    // Mirrors itMailboxConfigured() / conditionMailboxConfigured(), but names what is missing.
    // Names only — never a value.
    const missingGraph = GRAPH_VARS.filter(v => !process.env[v])
    const itAddress = process.env.IT_MAILBOX || "IT@vectis.co.uk" // same default as lib/it-mailbox.ts
    const conditionAddress = process.env.CONDITION_MAILBOX || ""

    // ⚠ Explicit selects: the rows also hold the access and refresh tokens, which must never be read here.
    // Read separately, so one table being unreadable doesn't hide the other.
    const [itRead, conditionRead] = await Promise.all([
      readRow(() => prisma.iTMailboxAuth.findUnique({
        where: { id: "global" },
        select: { connectedBy: true, lastSyncAt: true, updatedAt: true },
      })),
      readRow(() => prisma.conditionMailboxAuth.findUnique({
        where: { id: "global" },
        select: { connectedBy: true, lastSyncAt: true, updatedAt: true, folderName: true },
      })),
    ])

    const now = ctx.now.getTime()
    const bootedAt = (globalThis as { _bootedAt?: number })._bootedAt ?? null

    const verdicts = [
      judge({
        name: "IT inbox", label: `IT inbox (${itAddress})`, read: itRead, address: itAddress,
        missingGraph, now, bootedAt,
        reconnect: "there's no button for it in the Hub; an admin opens /api/it-mailbox/auth in the browser and signs in to Microsoft again",
      }),
      judge({
        name: "condition-report inbox", label: `Condition-report inbox (${conditionAddress || "no address set"})`,
        read: conditionRead, address: conditionAddress, missingGraph, now, bootedAt,
        reconnect: "Condition Reports → Or connect a mailbox via Microsoft 365 → Reconnect",
      }),
    ]

    const anyConnected = verdicts.some(v => v.state !== "unused")
    const facts: Fact[] = [
      ...verdicts.map(v => v.fact),
      missingGraph.length
        ? { label: "Microsoft sign-in settings", value: `Missing: ${missingGraph.join(", ")}`, ...(anyConnected ? { tone: "bad" as const } : {}) }
        : { label: "Microsoft sign-in settings", value: "Set" },
      { label: "How it's checked", value: "Each connected inbox is read every 5 minutes by a background job. Red after 15 minutes without a successful read. No call is made to Microsoft by this check." },
      optionalFact,
    ]

    if (!anyConnected) {
      return { state: "off", summary: "Not in use — neither Microsoft mailbox is connected.", facts }
    }

    const used = verdicts.filter((v): v is Verdict & { state: StatusState } => v.state !== "unused")
    const worst = used.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a))

    if (worst.state === "ok") {
      return {
        state: "ok",
        summary: used.length > 1 ? "Both connected mailboxes were read in the last 15 minutes." : `${capitalise(used[0].line)}.`,
        facts,
      }
    }

    const problems = used.filter(v => v.state !== "ok").sort((a, b) => RANK[b.state] - RANK[a.state])
    // The headline (worst) problem decides whose side the light is on. Only reds carry a
    // cause, so a grey "waiting for the next poll" never claims one.
    const cause = problems[0].cause
    return { state: worst.state, summary: `${capitalise(problems.map(p => p.line).join("; "))}.`, facts, ...(cause ? { cause } : {}) }
  },
}

export default mailboxes
