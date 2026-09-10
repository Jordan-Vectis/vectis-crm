import { Client } from "pg"
import { prisma } from "@/lib/prisma"
import { refusedWritesSince } from "../signals"
import type { CheckContext, CheckResult, Fact, StatusCheckDef } from "../types"

// 🗄 Database (Neon) — can the Hub actually SAVE, on every connection it might be handed?
//
// ⚠⚠ THE MODEL CASE IS 2026-09-09 (memory: reference_db_readonly_incident.md). Production's Neon
// compute came up with `default_transaction_read_only = on`: every read worked, every save was
// refused with SQLSTATE 25006, and Railway's and Neon's status pages were green all day. Then,
// after the compute recovered, Neon's pooler kept ONE server connection from the read-only spell
// (backend pid 12954) and handed it out at random — 7 of 25 pooled connections refused saves,
// 0 of 15 direct ones did, and ~28% of saves failed for hours. Twice that day a single probe
// "proved" it had cleared because it happened to land on a good connection.
//
// So this check:
//  1. Times the Hub's OWN Prisma pool (SELECT 1 ×3) — the answer time staff actually feel. It
//     goes first so that on a branch whose compute has scaled to zero it wakes it, and the
//     sample below isn't read as "slow" because of a cold start.
//  2. Opens 25 separate connections through DATABASE_URL (Neon's pooler) and makes each one hold
//     its OWN server connection at the same time — see samplePooled for why that matters.
//  3. Does the same with 3 connections straight to the compute ("-pooler" taken off the host).
//     A difference between the two routes is what localised 09-09 to the pooler in one step.
//  4. Reads the refused saves the Hub noticed for real since the last check (lib/status/signals).
//
// ⚠ READ-ONLY. It reads two settings and a pid. Never pg_is_in_recovery() — it returns false on a
// read-only Neon compute (Neon computes aren't streaming replicas); it was used to "rule out" the
// problem on 09-09 and was wrong. Never a probe row, never a rolled-back test write.
//
// ⚠ It needs no background jobs and no production-only data: every environment's DATABASE_URL is
// its own Neon branch, and what's measured is that branch, live. So it runs everywhere.

const POOLED_SAMPLES = 25
const DIRECT_SAMPLES = 3
const CONNECT_TIMEOUT_MS = 5_000
/** Client-side only (pg's query_timeout never reaches the server) — see newClient. */
const QUERY_TIMEOUT_MS = 5_000
/** How long a sample keeps its transaction open waiting for the others to answer. */
const HOLD_MS = 2_500
/** Cap on ROLLBACK and on end() — neither may hold the check up. */
const TIDY_MS = 2_000
const APP_POOL_TRIES = 3
const APP_POOL_CAP_MS = 6_000
// Railway → Neon is a TLS handshake plus password exchange: normally well under half a second,
// even with 25 at once. Judged on the MEDIAN, so one slow sample is not an outage.
const SLOW_CONNECT_MS = 2_500
const SLOW_QUERY_MS = 1_500
const SLOW_APP_MS = 1_000
/** Look-back for refused saves on the first run after a restart, when there's no "last check". */
const FIRST_LOOKBACK_MS = 10 * 60_000

// The same two settings app/api/health/db-writable reads, plus the backend pid so a bad connection
// can be named. `transaction_read_only` is what THIS transaction would do with a save.
const PROBE_SQL =
  "SELECT current_setting('default_transaction_read_only') AS d, " +
  "current_setting('transaction_read_only') AS t, pg_backend_pid() AS pid"

// ── Error words ─────────────────────────────────────────────────────────────────

type ErrInfo = { kind: string; words: string }

/**
 * Plain words for a failed connection or query. ⚠ Never the error's own message: pg and Prisma put
 * the host name in them (adapter-pg's DatabaseNotReachable carries `host`), and a Neon endpoint id
 * is enough to aim at the project. Only the kind, and a bare SQLSTATE / errno code, go on screen.
 * Walks the cause chain because Prisma 7 wraps pg's error (the lib/db-readonly.ts lesson).
 */
function classify(e: unknown): ErrInfo {
  const codes: string[] = []
  const kinds: string[] = []
  let text = ""
  let node = e as Record<string, unknown> | null | undefined
  for (let depth = 0; node && typeof node === "object" && depth < 6; depth++) {
    for (const c of [node.code, node.originalCode]) if (typeof c === "string") codes.push(c)
    if (typeof node.kind === "string") kinds.push(node.kind)
    for (const m of [node.message, node.originalMessage, node.reason]) if (typeof m === "string") text += " " + m
    node = node.cause as Record<string, unknown> | null | undefined
  }
  if (typeof e === "string") text += " " + e
  const code = (...c: string[]) => codes.some(x => c.includes(x))
  const kind = (...k: string[]) => kinds.some(x => k.includes(x))
  const says = (re: RegExp) => re.test(text)
  const is = (k: string, words: string): ErrInfo => ({ kind: k, words })

  if (code("25006") || says(/read-only transaction/i)) return is("read_only", "the database refused it as read-only")
  if (code("28P01", "28000") || kind("AuthenticationFailed", "DatabaseAccessDenied") || says(/password authentication failed/i))
    return is("auth", "the database refused the password")
  if (code("3D000") || kind("DatabaseDoesNotExist")) return is("no_db", "the database named in the settings doesn't exist")
  if (says(/quota/i) || says(/endpoint (has been|is) disabled/i))
    return is("neon_off", "Neon has switched the database off (a plan limit, or the compute is disabled)")
  if (says(/couldn't connect to compute|compute (node|is) (unavailable|not available)/i))
    return is("compute", "Neon couldn't start the database's computer")
  if (code("53300") || kind("TooManyConnections") || says(/too many (clients|connections)|no more connections allowed|remaining connection slots/i))
    return is("full", "the database has no free connections")
  if (says(/query_wait_timeout/i)) return is("queue", "Neon's pooler had no free connection to hand out in time")
  if (code("57P01", "57P02", "57P03") || says(/starting up|shutting down|administrator command/i))
    return is("restarting", "the database is restarting")
  if (code("ENOTFOUND", "EAI_AGAIN") || says(/getaddrinfo/i)) return is("dns", "the database's address couldn't be looked up")
  if (code("ECONNREFUSED") || kind("DatabaseNotReachable")) return is("unreachable", "the database couldn't be reached")
  if (code("ETIMEDOUT") || kind("SocketTimeout") || says(/timeout|timed out/i)) return is("timeout", "the database didn't answer in time")
  if (kind("TlsConnectionError") || codes.some(c => /^(CERT_|ERR_TLS|ERR_SSL|UNABLE_TO_|DEPTH_ZERO|SELF_SIGNED|HOSTNAME_MISMATCH)/.test(c)) || says(/\b(ssl|tls|certificate)\b/i))
    return is("tls", "a secure connection couldn't be set up")
  if (code("ECONNRESET", "EPIPE") || kind("ConnectionClosed") || says(/connection terminated|connection closed|socket hang up/i))
    return is("dropped", "the connection was dropped")
  if (says(/invalid url|connection string/i)) return is("config", "the database address in the settings couldn't be read")
  const shown = codes.find(c => /^[A-Z0-9_]{2,40}$/i.test(c))
  return is(`other:${shown ?? "?"}`, shown ? `an unexpected error came back (code ${shown})` : "an unexpected error came back")
}

/** Failures where the database, its pooler or the settings actively turned a connection away — as
 *  opposed to a network wobble. Only these make "no new connection works" red while the Hub's own
 *  connections still answer (see the verdict). */
const REFUSED_KINDS = new Set(["read_only", "auth", "no_db", "neon_off", "full", "queue", "config"])

// ── Sampling ────────────────────────────────────────────────────────────────────

type Sample =
  | { ok: true; readOnly: boolean; pid: number | null; connectMs: number; queryMs: number }
  | { ok: false; err: ErrInfo }

type Slot = {
  client: Client | null
  connected: boolean
  connectMs: number
  queryMs: number
  row?: { d?: unknown; t?: unknown; pid?: unknown }
  err?: ErrInfo
}

const TIMED_OUT = Symbol("timed out")

/** Resolves with the promise's value, or TIMED_OUT after `ms`. The loser keeps running unobserved
 *  (Promise.race subscribes to it, so a late rejection is never an unhandled one). */
function within<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<typeof TIMED_OUT>(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), ms) }),
  ]).finally(() => clearTimeout(timer))
}

const since = (t: number) => Math.round(performance.now() - t)

function newClient(connectionString: string): Client {
  // ⚠ ONLY client-side options. The startup packet is then exactly what the app's own pool sends
  // (adapter-pg builds its pg.Pool from the same bare connection string), so if the Hub can log in
  // through Neon's pooler, so can this. `statement_timeout` or `options` would be sent as startup
  // parameters (node_modules/pg/lib/client.js getStartupConf), which PgBouncer may refuse — every
  // sample would fail and the light would go red while the Hub was fine. And never a SET instead:
  // on a transaction-mode pooler a SET stays on the shared server connection for the next client,
  // the same class of mechanism as the 09-09 poison.
  const client = new Client({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS, query_timeout: QUERY_TIMEOUT_MS })
  // ⚠ BEFORE connect. pg emits 'error' when the server kills an open connection — a Neon compute
  // restart (the 09-09 fix) does exactly that — and an 'error' with no listener throws and takes
  // the whole server.js process down, sockets and all. The sample's own promise reports the fault.
  client.on("error", () => {})
  return client
}

/** end() with a cap: on a connection that died mid-connect it can wait for an 'end' event that has
 *  already fired (node_modules/pg/lib/client.js end()). */
async function endQuietly(client: Client): Promise<void> {
  try { await within(client.end(), TIDY_MS) } catch { /* already gone */ }
}

function firstRow(res: unknown): Slot["row"] {
  // "BEGIN; SELECT …" is two statements in one simple query, so pg hands back one result per
  // statement; the SELECT's is the last.
  const last = Array.isArray(res) ? res[res.length - 1] : res
  return (last as { rows?: Slot["row"][] } | undefined)?.rows?.[0]
}

/**
 * Opens `n` connections and makes every one of them hold its OWN server connection at the same
 * moment, then reads the read-only settings on each.
 *
 * ⚠ WHY NOT JUST OPEN 25 AND ASK. Neon's pooler is PgBouncer in transaction mode (Neon's docs — not
 * provable from this repo): a server connection is lent for ONE transaction, then goes back to the
 * pool. 25 client connections firing one-millisecond SELECTs can all be answered by the same one or
 * two healthy server connections — the one-good-connection trap from 09-09, dressed up as 25
 * samples. So each sample opens a transaction (plain BEGIN) and keeps it open until every sample
 * has answered: while it is open the pooler cannot lend that server connection to anyone else, so
 * it has to hand out a different one — including any poisoned one sitting idle — to each sample.
 *
 * ⚠ Plain BEGIN, NEVER `BEGIN READ ONLY` — that sets transaction_read_only = on by itself and every
 * sample would read as refusing saves. A transaction that only SELECTs writes nothing and takes no
 * transaction id; the ROLLBACK hands the server connection back clean. (Just disconnecting mid-
 * transaction would make the pooler throw that server connection away — 25 fresh backends every tick.)
 *
 * ⚠ Honest limit: n samples can see at most n server connections. If the pooler holds more than n
 * idle, a bad one can still be missed on a given run — which is why "different connections reached"
 * is shown, and why the refused-saves signal sits beside it.
 */
async function sampleConnections(connectionString: string, n: number): Promise<Sample[]> {
  const slots: Slot[] = []
  for (let i = 0; i < n; i++) {
    try {
      slots.push({ client: newClient(connectionString), connected: false, connectMs: 0, queryMs: 0 })
    } catch (e) {
      // A connection string pg can't parse — the Hub's own pool is built from the same one.
      slots.push({ client: null, connected: false, connectMs: 0, queryMs: 0, err: classify(e) })
    }
  }
  try {
    // Phase 1: connect them all. No query yet, so TLS jitter can't spread the queries apart.
    await Promise.all(slots.map(async s => {
      if (!s.client) return
      const t = performance.now()
      try {
        await s.client.connect()
        s.connected = true
      } catch (e) {
        s.err = classify(e)
      }
      s.connectMs = since(t)
    }))

    // Phase 2: every connected sample opens its transaction and asks, all at once.
    const live = slots.filter(s => s.connected && s.client)
    const answers = live.map(async s => {
      const t = performance.now()
      try {
        s.row = firstRow(await s.client!.query(`BEGIN; ${PROBE_SQL}`))
        if (!s.row) s.err = { kind: "no_answer", words: "the database sent back an empty answer" }
      } catch (e) {
        s.err = classify(e)
      }
      s.queryMs = since(t)
    })

    // Hold until everyone has answered, or HOLD_MS. If the pooler has fewer server connections to
    // lend than we asked for, the late ones queue; releasing after HOLD_MS lets them through
    // (reusing a pid, and counted as slow) rather than deadlocking until the timeout.
    await within(Promise.all(answers), HOLD_MS)

    // Phase 3: hand every server connection back — each after its own answer (bounded by
    // QUERY_TIMEOUT_MS). Errors ignored: the finally below closes whatever is left.
    await Promise.all(live.map(async (s, i) => {
      await answers[i]
      try { await within(s.client!.query("ROLLBACK"), TIDY_MS) } catch { /* closed below */ }
    }))
  } finally {
    await Promise.all(slots.map(s => (s.client ? endQuietly(s.client) : Promise.resolve())))
  }

  return slots.map((s): Sample => {
    if (s.err || !s.row) return { ok: false, err: s.err ?? { kind: "no_answer", words: "the database sent back an empty answer" } }
    const pid = Number(s.row.pid)
    return {
      ok: true,
      readOnly: String(s.row.d) === "on" || String(s.row.t) === "on",
      pid: Number.isFinite(pid) ? pid : null,
      connectMs: s.connectMs,
      queryMs: s.queryMs,
    }
  })
}

/**
 * The same database without Neon's pooler: DATABASE_URL with "-pooler" taken off the endpoint's
 * host label (ep-xxx-pooler.eu-west-2.aws.neon.tech → ep-xxx.eu-west-2.aws.neon.tech). Nothing in
 * the Hub connects this way — it's purely to tell "a stale pooler connection" from "the database
 * itself is read-only". No new secret: same credential, different host.
 * ⚠ The derived address is never shown or logged.
 */
function directUrl(url: string): { url: string } | { reason: "not_pooled" | "unreadable" } {
  try {
    const u = new URL(url)
    const [first, ...rest] = u.hostname.split(".")
    if (!first || !first.endsWith("-pooler")) return { reason: "not_pooled" }
    u.hostname = [first.slice(0, -"-pooler".length), ...rest].join(".")
    return { url: u.toString() }
  } catch {
    return { reason: "unreadable" }
  }
}

/** The Hub's own path: pool checkout + a trivial query, as every page and save experiences it. */
async function timeAppPool(): Promise<{ times: number[]; err?: ErrInfo }> {
  const times: number[] = []
  // ⚠ Capped from outside: the app's pg.Pool has no connect timeout of its own (pg-pool default 0),
  // so against an unreachable database $queryRaw can wait minutes.
  const run = (async () => {
    for (let i = 0; i < APP_POOL_TRIES; i++) {
      const t = performance.now()
      await prisma.$queryRaw`SELECT 1`
      times.push(since(t))
    }
  })()
  try {
    const r = await within(run, APP_POOL_CAP_MS)
    if (r === TIMED_OUT) return { times, err: { kind: "timeout", words: "the database didn't answer in time" } }
    return { times }
  } catch (e) {
    return { times, err: classify(e) }
  }
}

// ── Refused saves the Hub noticed for real ─────────────────────────────────────────

type DbCheckMem = { lastReadAt?: number }
function checkMem(): DbCheckMem {
  // globalThis, not a module variable — Next can load this module once per route bundle (signals.ts).
  const g = globalThis as unknown as { _statusDbCheck?: DbCheckMem }
  return (g._statusDbCheck ??= {})
}

function readRefused(): { count: number; latest: number | null; firstRun: boolean; everLatest: number | null } {
  const m = checkMem()
  // ⚠ The window is marked at the moment of READING, never at ctx.now (when the run began, up to
  // ~20 s earlier). Marking it at ctx.now counted a save refused during a run in that run AND the
  // next — two bad results in a row from one burst, which is exactly what rings the bell.
  const readAt = Date.now()
  const firstRun = m.lastReadAt === undefined
  const from = m.lastReadAt ?? readAt - FIRST_LOOKBACK_MS
  m.lastReadAt = readAt + 1 // refusedWritesSince is inclusive; +1 so a hit AT readAt isn't counted twice
  const hits = refusedWritesSince(from).filter(t => t <= readAt)
  const ever = refusedWritesSince(0)
  return {
    count: hits.length,
    latest: hits.length ? Math.max(...hits) : null,
    firstRun,
    everLatest: ever.length ? Math.max(...ever) : null,
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────────

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

function clock(ms: number, withDay = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", ...(withDay ? { weekday: "short" } : {}),
  }).format(new Date(ms))
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The most common failure, in words, plus whether there were other kinds too. */
function mainFailure(samples: Sample[]): { words: string; mixed: boolean } | null {
  const counts = new Map<string, { n: number; words: string }>()
  for (const s of samples) {
    if (s.ok) continue
    const c = counts.get(s.err.kind) ?? { n: 0, words: s.err.words }
    c.n++
    counts.set(s.err.kind, c)
  }
  if (!counts.size) return null
  const top = [...counts.values()].sort((a, b) => b.n - a.n)[0]
  return { words: top.words, mixed: counts.size > 1 }
}

type Tally = { n: number; answered: number; readOnly: number; failed: number; pids: Map<number, number>; roPids: Map<number, number> }

function tally(samples: Sample[]): Tally {
  const t: Tally = { n: samples.length, answered: 0, readOnly: 0, failed: 0, pids: new Map(), roPids: new Map() }
  for (const s of samples) {
    if (!s.ok) { t.failed++; continue }
    t.answered++
    if (s.pid !== null) t.pids.set(s.pid, (t.pids.get(s.pid) ?? 0) + 1)
    if (s.readOnly) {
      t.readOnly++
      if (s.pid !== null) t.roPids.set(s.pid, (t.roPids.get(s.pid) ?? 0) + 1)
    }
  }
  return t
}

// ── The check ────────────────────────────────────────────────────────────────────

async function run(ctx: CheckContext): Promise<CheckResult> {
  const url = process.env.DATABASE_URL
  if (!url) {
    return { state: "unknown", summary: "This server has no database address set, so the check couldn't run.", facts: [] }
  }

  // 1. The Hub's own pool first (wakes a sleeping branch — see the header).
  const app = await timeAppPool()

  // 2 + 3. Pooled and direct side by side. They reach the compute by different doors, so running
  // them together costs nothing in accuracy and keeps the whole check well inside the engine's
  // 25 s cap (worst case ≈ 6 + 5 + 5 + 2 + 2 s). The 3 direct ones are opened together too: each
  // is its own backend on the compute whatever the order, and 3 slots is nothing against its limit.
  const direct = directUrl(url)
  const [pooledSamples, directSamples] = await Promise.all([
    sampleConnections(url, POOLED_SAMPLES),
    "url" in direct ? sampleConnections(direct.url, DIRECT_SAMPLES) : Promise.resolve(null),
  ])

  // 4. Real saves refused since the last check.
  const refused = readRefused()

  const p = tally(pooledSamples)
  const d = directSamples ? tally(directSamples) : null
  const canSave = p.answered - p.readOnly
  const ok = pooledSamples.filter((s): s is Extract<Sample, { ok: true }> => s.ok)
  const connectP50 = median(ok.map(s => s.connectMs))
  const connectMax = ok.length ? Math.max(...ok.map(s => s.connectMs)) : null
  const queryP50 = median(ok.map(s => s.queryMs))
  const appMedian = app.err ? null : median(app.times)
  const failure = mainFailure(pooledSamples)
  const failureWords = failure ? failure.words + (failure.mixed ? " (and other errors)" : "") : ""
  const computeName = ctx.isProduction ? "the production compute" : `the ${ctx.env} branch's compute`

  // ── Facts ──
  const facts: Fact[] = []
  facts.push({
    label: "Connections that can save",
    value: `${canSave} of ${p.n}`,
    tone: canSave === p.n ? "good" : p.readOnly || p.answered === 0 ? "bad" : "warn",
  })
  if (p.readOnly) {
    const which = [...p.roPids.entries()].sort((a, b) => b[1] - a[1])
      .map(([pid, n]) => `server process ${pid} (${n} of ${p.n})`).join(", ")
    facts.push({ label: "Connections refusing saves", value: which || `${p.readOnly} of ${p.n} (process not reported)`, tone: "bad" })
  }
  if (p.failed) {
    facts.push({ label: "Couldn't connect or answer", value: `${p.failed} of ${p.n}: ${failureWords}`, tone: p.answered ? "warn" : "bad" })
  }
  facts.push({
    label: refused.firstRun ? "Refused saves in the last 10 minutes" : "Refused saves since the last check",
    value: refused.count ? `${refused.count} (latest ${clock(refused.latest!)})` : "None",
    tone: refused.count ? "bad" : "good",
  })
  if (!refused.count && refused.everLatest !== null) {
    facts.push({ label: "Last refused save", value: clock(refused.everLatest, true) })
  }
  facts.push(app.err
    ? { label: "Answer time", value: `The Hub's own connections failed: ${app.err.words}`, tone: "bad" }
    : { label: "Answer time", value: `${fmtMs(appMedian ?? 0)} (the Hub's own connections)`, tone: (appMedian ?? 0) > SLOW_APP_MS ? "warn" : "good" })
  if (connectP50 !== null && connectMax !== null) {
    facts.push({
      label: "Opening a new connection",
      value: `typically ${fmtMs(connectP50)}, slowest ${fmtMs(connectMax)}`,
      tone: connectP50 > SLOW_CONNECT_MS ? "warn" : undefined,
    })
  }
  if (p.answered) {
    facts.push({
      label: "Different connections reached",
      value: `${p.pids.size} of ${p.answered} answers`,
      tone: p.pids.size < 2 && p.answered >= 2 ? "warn" : undefined,
    })
  }
  facts.push({
    label: "Through Neon's pooler (what the Hub uses)",
    value: p.answered
      ? `${p.readOnly} of ${p.n} refusing saves${p.failed ? `, ${p.failed} couldn't connect or answer` : ""}`
      : `none of ${p.n} could connect`,
    tone: p.readOnly || !p.answered ? "bad" : p.failed ? "warn" : "good",
  })
  let directLine: Fact
  if (!d) {
    directLine = "reason" in direct && direct.reason === "not_pooled"
      ? { label: "Straight to the database", value: "Not needed — the Hub already connects straight to the database" }
      : { label: "Straight to the database", value: "Comparison unavailable — couldn't work it out from the database address" }
  } else if (!d.answered) {
    const why = mainFailure(directSamples!)
    directLine = { label: "Straight to the database", value: `Comparison unavailable — couldn't connect (${why?.words ?? "unknown reason"})` }
  } else {
    directLine = {
      label: "Straight to the database",
      value: `${d.readOnly} of ${d.n} refusing saves${d.failed ? `, ${d.failed} couldn't connect or answer` : ""}`,
      tone: d.readOnly ? "bad" : "good",
    }
  }
  facts.push(directLine)

  const directClean = !!d && d.answered > 0 && d.readOnly === 0
  const directBad = !!d && d.readOnly > 0
  if (p.readOnly && directClean) {
    facts.push({ label: "What that means", value: "Only connections through Neon's pooler refuse saves: it is holding a stale connection from a read-only spell, as on 9 September. Restarting the compute clears it." })
  } else if (p.readOnly && directBad) {
    facts.push({ label: "What that means", value: "Both routes refuse saves, so the database itself is read-only — not just the pooler." })
  } else if (!p.readOnly && directBad) {
    facts.push({ label: "What that means", value: "New connections straight to the database come up read-only, although the pooler's current ones are fine. Saves will start failing as the pooler opens new connections." })
  }
  if (p.readOnly) {
    facts.push({ label: "Fix", value: `Neon console → Computes → ${computeName} → Restart. That drops every pooled connection, including the bad ones.` })
  }

  const latencyMs = appMedian ?? queryP50 ?? undefined

  // ── Verdict ──
  // DOWN: any sample read-only (the poisoned-pooler case — even 1 in 25 loses saves at random).
  if (p.readOnly) {
    const all = p.readOnly === p.n
    return {
      state: "down",
      summary: all
        ? `${p.readOnly} of ${p.n} connections are refusing saves — nothing can be saved.`
        : `${p.readOnly} of ${p.n} connections are refusing saves.`,
      facts, latencyMs,
    }
  }
  // No fresh connection works at all.
  // DOWN when the Hub's own connections failed too (nothing works), or when the database or its
  // pooler actively REFUSED the new ones — a wrong password (changed in Neon, not in Railway), a
  // missing database, Neon switching it off, no free connections. The Hub's pool replaces its
  // connections constantly (idle ones close after 10 s), so a refusal like that reaches it next.
  // ⚠ Otherwise DEGRADED, not down: if the Hub's own connections answered and the new ones only hit
  // a network wobble (a timeout, a failed address lookup, a dropped line), the Hub is still working
  // right now, and one such blip painted the tile red for five minutes. If it lasts, the Hub's own
  // connections fail as they renew and the next check goes red on the branch above.
  if (!p.answered) {
    const refusedOutright = pooledSamples.some(s => !s.ok && REFUSED_KINDS.has(s.err.kind))
    if (app.err || refusedOutright) {
      return {
        state: "down",
        summary: app.err
          ? `No connection to the database works: ${failureWords || app.err.words}.`
          : `No new connection to the database works: ${failureWords}.`,
        facts, latencyMs,
      }
    }
    return {
      state: "degraded",
      summary: `The Hub's own connections work, but no new connection could be opened: ${failureWords}.`,
      facts, latencyMs,
    }
  }

  // DEGRADED: working, with problems. The first reason found becomes the summary.
  const reasons: string[] = []
  if (p.failed) reasons.push(`${canSave} of ${p.n} connections can save; ${p.failed} couldn't connect or answer — ${failureWords}.`)
  if (refused.count) reasons.push(`${canSave} of ${p.n} connections can save now, but ${plural(refused.count, "save was", "saves were")} refused as read-only ${refused.firstRun ? "in the last 10 minutes" : "since the last check"}.`)
  if (directBad) reasons.push(`${canSave} of ${p.n} connections can save, but new connections straight to the database are coming up read-only.`)
  if (app.err) reasons.push(`New connections can save, but the Hub's own connections failed: ${app.err.words}.`)
  const slow = (connectP50 ?? 0) > SLOW_CONNECT_MS || (queryP50 ?? 0) > SLOW_QUERY_MS || (appMedian ?? 0) > SLOW_APP_MS
  if (slow) {
    const worst = Math.max(appMedian ?? 0, queryP50 ?? 0, connectP50 ?? 0)
    reasons.push(`${canSave} of ${p.n} connections can save, but the database is slow to answer (${fmtMs(worst)}).`)
  }
  if (p.pids.size < 2 && p.answered >= 2) {
    reasons.push(`${canSave} of ${p.n} connections can save, but every answer came from one connection, so a bad one could be hiding.`)
  }
  if (reasons.length) return { state: "degraded", summary: reasons[0], facts, latencyMs }

  return { state: "ok", summary: `${canSave} of ${p.n} connections can save.`, facts, latencyMs }
}

const database: StatusCheckDef = {
  key: "database",
  name: "Database",
  group: "hub",
  what: "Where every lot, sale, login and setting is kept (Neon).",
  whenDown: "Nothing can be saved — or, as on 9 September, pages load while saves quietly fail.",
  statusPage: "https://neonstatus.com",
  intervalMin: 5,
  timeoutMs: 25_000,
  run,
}

export default database
