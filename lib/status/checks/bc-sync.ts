import { prisma } from "@/lib/prisma"
import type { CheckContext, CheckResult, Fact, StatusCheckDef } from "../types"

// 🚦 BC data copy — how fresh is the Hub's OWN copy of Business Central?
//
// End of Day → BC, BC Match, the tote checks and the Admin Centre never ask BC live; they read the
// WarehouseItem / WarehouseTote / WarehouseReceiptTote copy that the timed job in server.js refreshes
// every 12 hours (counted from boot) plus a full walk at 05:00 London. When that copy stops moving,
// those screens quietly show yesterday's truth.
//
// Passive: WarehouseSyncLog only, no BC call. Every stage PASS writes its own row (running →
// complete | failed), so the honest signal is the age of each part's last COMPLETE pass.
//
// ⚠⚠ Judge by the last success, never by "no errors recorded" (the 2026-09-09 lesson). Two common
// failures leave NO failed row at all: with no usable BC sign-in every stage returns 503
// BC_NOT_CONNECTED before it creates its log row (receipt-lines/route.ts), and on a read-only
// database the log row's own INSERT is refused. Only age shows either.
//
// ⚠ Page auto-sync can make parts look fresh while the timer is dead: opening BC Warehouse runs
// receipt lines, auction lines, changelog, totes and open totes when they're 15 min stale — but
// NEVER totes-all or reconcile-deleted. That is why totes-all is a MAIN part: it only moves when the
// schedule (or the manual Data Sync) really ran.
//
// ⚠ "complete" means ONE PASS finished, not "caught up": receipt-lines stops on its budget and still
// writes complete. And a totes-all pass whose BC answer is an empty 200 is ALSO marked complete with
// 0 items — so 13 hours of totes-all passes adding up to 0 totes is flagged, not trusted.
//
// ⚠ Rows stuck "running" are never cleaned up; a pass killed by a deploy leaves one for ever. Only the
// LATEST attempt for a part, started 3–24 h ago with nothing complete since, counts — older orphans
// would otherwise turn this amber permanently after the first crash.
//
// ⚠ Staging/sandbox databases are branches of production holding copied timestamps that stopped
// moving the day they were made, so "off" wherever the background jobs don't run.
//
// Not recorded anywhere, so never guessed: whether the 05:00 FULL walk specifically ran (the cron
// route's summary goes only to the Railway log), and the auction-names stage (it writes no log row).

type Part = { key: string; label: string; main: boolean }

/** In the order the detail panel lists them. `main` = the parts the working screens depend on. */
const PARTS: Part[] = [
  { key: "receipt_lines",     label: "Receipts and lots",            main: true },
  { key: "auction_lines",     label: "Sale lot numbers",             main: true },
  { key: "totes-all",         label: "Tote-to-receipt list",         main: true },
  { key: "changelog",         label: "Location changes",             main: false },
  { key: "totes",             label: "Tote locations",               main: false },
  { key: "totes-active",      label: "Open totes",                   main: false },
  { key: "reconcile-deleted", label: "Tidy-up of lines deleted in BC", main: false },
]

const HOUR = 3_600_000
/** 12-hour cadence plus the time a run takes. */
const FRESH_H = 13
/** Two whole cycles missed — the copy has stopped, not just slipped. */
const DOWN_H = 26
/** The cron's own "a running pass older than this is dead" rule (cron/bc-warehouse/route.ts). */
const STUCK_FROM_H = 3
const STUCK_TO_H = 24

type Row = {
  source: string
  lastCompleteMs: unknown
  recentItems: unknown
  recentRuns: unknown
  latestStatus: string | null
  latestStartedMs: unknown
  lastFailedMs: unknown
  lastFailedError: string | null
}

/** Raw-query numbers can arrive as number, string or bigint depending on the column type. */
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : typeof v === "string" ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

function fmtAge(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 1) return "under a minute"
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60), m = min % 60
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`
  return `${Math.round(h / 24)} days`
}

function fmtLondon(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(ms))
}

/** A stored sync error in a few plain words — BC's status and code, not its message or any address. */
function plainError(raw: string | null, max: number): string {
  if (!raw || !raw.trim()) return "no reason was recorded"
  const bc = raw.match(/BC API (?:companies )?(\d{3})/)
  if (bc) {
    const code = raw.match(/"code"\s*:\s*"([\w.-]{1,60})"/)
    return `Business Central answered with error ${bc[1]}${code ? ` (${code[1]})` : ""}`
  }
  if (/BC_NOT_CONNECTED/.test(raw)) return "no usable BC sign-in"
  if (/timed? ?out|aborted/i.test(raw)) return "timed out waiting for an answer"
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  // Prisma puts "Invalid `prisma.x()` invocation:" first and the actual cause last.
  let line = /^Invalid `prisma/.test(lines[0] ?? "") && lines.length > 1 ? lines[lines.length - 1] : (lines[0] ?? "")
  line = line
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "…")
    .replace(/\bhttps?:\/\/\S+/gi, "…")
    .replace(/[.:]+$/, "")
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

type Verdict = {
  part: Part
  lastMs: number | null
  ageMs: number             // Infinity when it has never completed
  failedMs: number | null   // a failure NEWER than the last complete pass
  failedError: string | null
  stuckMs: number | null    // the latest attempt, dead, with nothing complete since
  empty: boolean            // totes-all passes completed recently but read no totes
}

async function run(ctx: CheckContext): Promise<CheckResult> {
  if (!ctx.backgroundJobsExpected) {
    return { state: "off", summary: "The timed BC copy doesn't run on this environment, so there's nothing to check here." }
  }

  const now = ctx.now.getTime()
  // ⚠ Columns are naive UTC timestamps. The cutoff goes in as a UTC ISO string cast to `timestamp`,
  // which Postgres reads ignoring the "Z" — i.e. as UTC, matching what is stored. Times come back as
  // epoch ms (extract(epoch) treats a naive timestamp as UTC), so no driver time-zone guessing.
  const cutoff = new Date(now - FRESH_H * HOUR).toISOString()

  let rows: Row[]
  try {
    // One round trip. Three separate scans rather than a shared CTE, so Postgres never materialises
    // the whole log (error text included) just to aggregate it.
    rows = await prisma.$queryRaw<Row[]>`
      WITH latest AS (
        SELECT DISTINCT ON ("source") "source", "status" AS "latestStatus",
               (extract(epoch FROM "startedAt") * 1000)::float8 AS "latestStartedMs"
        FROM "WarehouseSyncLog"
        WHERE "source" IN ('receipt_lines','auction_lines','totes-all','changelog','totes','totes-active','reconcile-deleted')
        ORDER BY "source", "startedAt" DESC
      ),
      done AS (
        SELECT "source",
               (extract(epoch FROM max("completedAt")) * 1000)::float8 AS "lastCompleteMs",
               COALESCE(sum("itemsProcessed") FILTER (WHERE "completedAt" > ${cutoff}::timestamp), 0)::int AS "recentItems",
               count(*) FILTER (WHERE "completedAt" > ${cutoff}::timestamp)::int AS "recentRuns"
        FROM "WarehouseSyncLog"
        WHERE "status" = 'complete'
          AND "source" IN ('receipt_lines','auction_lines','totes-all','changelog','totes','totes-active','reconcile-deleted')
        GROUP BY "source"
      ),
      failed AS (
        SELECT DISTINCT ON ("source") "source",
               (extract(epoch FROM COALESCE("completedAt", "startedAt")) * 1000)::float8 AS "lastFailedMs",
               left("error", 400) AS "lastFailedError"
        FROM "WarehouseSyncLog"
        WHERE "status" = 'failed'
          AND "source" IN ('receipt_lines','auction_lines','totes-all','changelog','totes','totes-active','reconcile-deleted')
        ORDER BY "source", "startedAt" DESC
      )
      SELECT l."source", d."lastCompleteMs", d."recentItems", d."recentRuns",
             l."latestStatus", l."latestStartedMs", f."lastFailedMs", f."lastFailedError"
      FROM latest l
      LEFT JOIN done   d ON d."source" = l."source"
      LEFT JOIN failed f ON f."source" = l."source"`
  } catch {
    return { state: "unknown", summary: "Couldn't read the BC copy's history from the database, so its age couldn't be checked." }
  }

  const bySource = new Map(rows.map(r => [r.source, r]))
  const verdicts: Verdict[] = PARTS.map(part => {
    const r = bySource.get(part.key)
    const lastMs = num(r?.lastCompleteMs)
    const failedAt = num(r?.lastFailedMs)
    const latestStarted = num(r?.latestStartedMs)
    const failedNow = failedAt != null && (lastMs == null || failedAt > lastMs)
    const latestAgeH = latestStarted != null ? (now - latestStarted) / HOUR : null
    const stuck = r?.latestStatus === "running" && latestStarted != null && latestAgeH != null
      && latestAgeH >= STUCK_FROM_H && latestAgeH <= STUCK_TO_H
      && (lastMs == null || latestStarted > lastMs)
    return {
      part,
      lastMs,
      ageMs: lastMs == null ? Infinity : now - lastMs,
      failedMs: failedNow ? failedAt : null,
      failedError: failedNow ? (r?.lastFailedError ?? null) : null,
      stuckMs: stuck ? latestStarted : null,
      empty: part.key === "totes-all" && (num(r?.recentRuns) ?? 0) > 0 && (num(r?.recentItems) ?? 0) === 0,
    }
  })

  // ── Facts: one line per part ──────────────────────────────────────────────────────────────────
  const facts: Fact[] = verdicts.map(v => {
    const { part } = v
    if (v.failedMs != null) {
      const worked = v.lastMs != null ? `; last worked ${fmtAge(v.ageMs)} ago` : ""
      return { label: part.label, value: `Last refresh failed ${fmtAge(now - v.failedMs)} ago — ${plainError(v.failedError, 140)}${worked}`, tone: "bad" }
    }
    if (v.stuckMs != null) {
      const worked = v.lastMs != null ? `; last worked ${fmtAge(v.ageMs)} ago` : ""
      return { label: part.label, value: `A refresh started ${fmtLondon(v.stuckMs)} and never finished${worked}`, tone: "warn" }
    }
    if (v.lastMs == null) {
      return { label: part.label, value: "Has never finished refreshing here", tone: part.main ? "bad" : "warn" }
    }
    const ageH = v.ageMs / HOUR
    const tone: Fact["tone"] = ageH > DOWN_H && part.main ? "bad" : ageH > FRESH_H ? "warn" : v.empty ? "warn" : "good"
    const extra = v.empty ? ", but Business Central sent no totes" : ""
    return { label: part.label, value: `Refreshed ${fmtAge(v.ageMs)} ago (${fmtLondon(v.lastMs)})${extra}`, tone }
  })
  facts.push({ label: "Expected", value: "Every 12 hours, plus a full refresh at 5am (the full refresh isn't recorded on its own)" })

  // ── State ─────────────────────────────────────────────────────────────────────────────────────
  const main = verdicts.filter(v => v.part.main)
  const newestMainAge = Math.min(...main.map(v => v.ageMs))

  if (newestMainAge > DOWN_H * HOUR) {
    // ⚠ Name only the MAIN parts: a secondary one (e.g. tote locations via a page visit) can still be
    // fresh, so "nothing has refreshed" would be untrue. And say the database can be the cause — on
    // 2026-09-09 the log row's own INSERT was refused, which ages this light exactly like a dead key.
    const summary = newestMainAge === Infinity
      ? "The Hub's copy of BC has never finished refreshing its receipts, lot numbers or tote list here — usually nobody's BC sign-in works, the timed jobs aren't running, or the database is refusing saves."
      : `The Hub's copy of BC hasn't refreshed its receipts, lot numbers or tote list for ${fmtAge(newestMainAge)} — usually nobody's BC sign-in works, the timed jobs have stopped, or the database is refusing saves.`
    return { state: "down", summary, facts }
  }

  // Problems, most important first: the parts the working screens depend on, then the rest.
  const problems: string[] = []
  for (const group of [main, verdicts.filter(v => !v.part.main)]) {
    for (const v of group) if (v.failedMs != null) {
      problems.push(`${v.part.label}: the last refresh failed ${fmtAge(now - v.failedMs)} ago — ${plainError(v.failedError, 80)}.`)
    }
    for (const v of group) if (v.stuckMs != null) {
      problems.push(`${v.part.label}: a refresh started ${fmtLondon(v.stuckMs)} and never finished, and nothing has refreshed it since.`)
    }
    for (const v of group) if (v.failedMs == null && v.stuckMs == null && v.ageMs > FRESH_H * HOUR) {
      problems.push(v.lastMs == null
        ? `${v.part.label}: has never finished refreshing here.`
        : `${v.part.label}: last refreshed ${fmtAge(v.ageMs)} ago — it should be every 12 hours.`)
    }
    for (const v of group) if (v.empty && v.failedMs == null && v.stuckMs == null && v.ageMs <= FRESH_H * HOUR) {
      problems.push(`${v.part.label}: refreshed, but Business Central sent no totes in the last ${FRESH_H} hours.`)
    }
  }

  if (problems.length) {
    const more = problems.length - 1
    const summary = more ? `${problems[0].replace(/\.$/, "")} (and ${more} more — see details).` : problems[0]
    return { state: "degraded", summary, facts }
  }

  const receipts = verdicts.find(v => v.part.key === "receipt_lines")
  return {
    state: "ok",
    summary: `Up to date — every part refreshed within the last ${FRESH_H} hours, receipts and lots ${fmtAge(receipts?.ageMs ?? 0)} ago.`,
    facts,
  }
}

const bcSync: StatusCheckDef = {
  key: "bc-sync",
  name: "BC data copy",
  group: "business-central",
  what: "The Hub's own copy of BC, refreshed twice a day and in full at 5am — End of Day, BC Match, tote checks and the Admin Centre read it.",
  whenDown: "Those screens show out-of-date BC information.",
  intervalMin: 15,
  run,
}

export default bcSync
