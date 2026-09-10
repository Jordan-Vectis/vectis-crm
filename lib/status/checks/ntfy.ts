import type { CheckResult, Fact, StatusCheckDef } from "@/lib/status/types"

// 📱 ntfy phone alerts — the Auction Monitor's sale-day push notifications.
//
// ⚠ The Hub's server never sends these. The Auction Monitor page, open in an office
// browser, POSTs straight to https://ntfy.sh with a topic kept in that browser's
// localStorage. So all this can show is that ntfy.sh ITSELF is up. It can't see the
// office's 250-a-day message allowance (counted per IP, and Railway's IP isn't the
// office's), the topic, or whether anyone's phone is subscribed.
//
// ⚠ GET /v1/health only — NEVER POST. A POST publishes a real notification: it buzzes
// phones and uses the daily allowance. (/v1/health is from ntfy's own server docs, not
// from this repo; a 404 here would mean it has moved, and says so.)
//
// ⚠ Information only, so never red, and one failure is grey. Railway's outgoing
// addresses are shared with many other customers and ntfy.sh rate-limits by address,
// so a single miss can be somebody else's fault (commerce + mail research, reviewer).
// Amber only after DEGRADED_AFTER failures in a row — and a 429 doesn't count towards
// that at all: it means our shared address was turned away, which says nothing about
// whether ntfy.sh is up for the office.
//
// The run of failures is kept on globalThis, not in a module variable: Next can load a
// module more than once (one copy per route bundle), same reason as lib/status/signals.ts.
// Lost on restart, which only means counting starts again.

const HEALTH_URL = "https://ntfy.sh/v1/health"
const TIMEOUT_MS = 5_000
const DEGRADED_AFTER = 3

type NtfyMem = { streak: number; lastOkAt: number | null }

function mem(): NtfyMem {
  const g = globalThis as unknown as { _statusNtfy?: NtfyMem }
  return (g._statusNtfy ??= { streak: 0, lastOkAt: null })
}

type Probe =
  | { kind: "ok"; latencyMs: number }
  | { kind: "limited" }
  /** Our health address has gone. That's this check being out of date, not ntfy failing. */
  | { kind: "moved" }
  /** `why` is a clause with no full stop, e.g. "ntfy.sh didn't answer within 5 seconds". */
  | { kind: "fail"; why: string; answer: string }

function describeNetworkError(e: unknown): { why: string; answer: string } {
  const err = e as { name?: string; cause?: { code?: string } } | null
  const code = err?.cause?.code ?? ""
  if (err?.name === "TimeoutError" || err?.name === "AbortError" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return { why: `ntfy.sh didn't answer within ${TIMEOUT_MS / 1000} seconds`, answer: "No answer (timed out)" }
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return { why: "the Hub's server couldn't look up ntfy.sh's address (a DNS failure)", answer: "Address lookup failed" }
  }
  if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "UND_ERR_SOCKET") {
    return { why: "ntfy.sh refused or dropped the connection", answer: "Connection refused or dropped" }
  }
  if (/CERT|TLS|SSL/i.test(code)) {
    return { why: "the secure connection to ntfy.sh failed", answer: "Secure connection failed" }
  }
  return { why: "the Hub's server couldn't reach ntfy.sh", answer: code ? `Network error (${code})` : "Network error" }
}

async function probe(): Promise<Probe> {
  const started = Date.now()
  let res: Response
  try {
    res = await fetch(HEALTH_URL, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "VectisHub status check" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    return { kind: "fail", ...describeNetworkError(e) }
  }
  const latencyMs = Date.now() - started
  // Free the connection on every path that doesn't read the body.
  const discard = () => res.body?.cancel().catch(() => {})

  if (res.status === 429) { await discard(); return { kind: "limited" } }
  // ⚠ A 404 means OUR health address is out of date, not that ntfy.sh is down: publishing is
  // a different address. Counting it as a failure would ring the bell with "phone alerts may
  // not be getting through" when nothing is wrong with them.
  if (res.status === 404) { await discard(); return { kind: "moved" } }
  if (res.status === 401 || res.status === 403) { await discard(); return { kind: "fail", why: `ntfy.sh refused the Hub's server (HTTP ${res.status})`, answer: `HTTP ${res.status}` } }
  if (res.status >= 500) { await discard(); return { kind: "fail", why: `ntfy.sh answered with a server error (HTTP ${res.status})`, answer: `HTTP ${res.status}` } }
  if (!res.ok) { await discard(); return { kind: "fail", why: `ntfy.sh gave an unexpected answer (HTTP ${res.status})`, answer: `HTTP ${res.status}` } }

  let body: unknown
  try {
    body = await res.json()
  } catch (e) {
    // The timeout covers reading the body too, so a stalled reply lands here, not in the catch above.
    const name = (e as { name?: string } | null)?.name
    if (name === "TimeoutError" || name === "AbortError") return { kind: "fail", ...describeNetworkError(e) }
    return { kind: "fail", why: "ntfy.sh answered, but not in the form expected", answer: "HTTP 200, not the expected reply" }
  }
  if ((body as { healthy?: unknown } | null)?.healthy === true) return { kind: "ok", latencyMs }
  return { kind: "fail", why: "ntfy.sh says it isn't healthy", answer: "healthy: false" }
}

function agoText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return "less than a minute ago"
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`
  return `${Math.floor(h / 24)} days ago`
}

/** Starts a sentence with a capital, except for the name "ntfy", which is always lower case. */
const capitalise = (s: string) => (s.startsWith("ntfy") ? s : s.charAt(0).toUpperCase() + s.slice(1))

const SCOPE_FACTS: Fact[] = [
  { label: "What this checks", value: "Only that ntfy.sh itself is up. The real alerts are sent by the office browsers running the Auction Monitor, not by the Hub's server." },
  { label: "Not covered", value: "The office's 250-a-day message allowance, the alert topic, and whether phones are subscribed." },
  { label: "Safe to run", value: "The check never sends a message, so no phone buzzes and no allowance is used." },
]

const ntfy: StatusCheckDef = {
  key: "ntfy",
  name: "ntfy phone alerts",
  group: "suppliers",
  what: "Phone alerts from the Auction Monitor during a live sale.",
  whenDown: "Sale-day phone alerts don't arrive.",
  intervalMin: 30,

  async run(ctx): Promise<CheckResult> {
    const m = mem()
    const p = await probe()
    const now = ctx.now.getTime()
    const lastGood = (): Fact => ({ label: "Last good answer", value: m.lastOkAt ? agoText(now - m.lastOkAt) : "None since the Hub last restarted" })

    if (p.kind === "ok") {
      m.streak = 0
      m.lastOkAt = now
      return {
        state: "ok",
        summary: "ntfy.sh says it is up.",
        latencyMs: p.latencyMs,
        facts: [{ label: "Answer", value: "Healthy", tone: "good" }, ...SCOPE_FACTS],
      }
    }

    if (p.kind === "limited") {
      // Neither a failure nor a success: the run of failures is left exactly as it was.
      return {
        state: "unknown",
        summary: "ntfy.sh asked the Hub's server to slow down, so this couldn't be checked — usually other sites sharing the server's address, not ntfy.",
        facts: [
          { label: "Answer", value: "HTTP 429 (rate limited)", tone: "warn" },
          { label: "Failed checks in a row", value: String(m.streak), tone: m.streak ? "warn" : "good" },
          lastGood(),
          ...SCOPE_FACTS,
        ],
      }
    }

    if (p.kind === "moved") {
      // Like a 429, this says nothing about ntfy itself, so the run of failures is left alone.
      return {
        state: "unknown",
        summary: "ntfy.sh no longer answers at the health address this check uses (HTTP 404), so the check needs updating. This doesn't mean alerts are failing.",
        facts: [
          { label: "Answer", value: "HTTP 404 at the health address", tone: "warn" },
          { label: "Failed checks in a row", value: String(m.streak), tone: m.streak ? "warn" : "good" },
          lastGood(),
          ...SCOPE_FACTS,
        ],
      }
    }

    m.streak += 1
    const facts: Fact[] = [
      { label: "Answer", value: p.answer, tone: m.streak >= DEGRADED_AFTER ? "bad" : "warn" },
      { label: "Failed checks in a row", value: String(m.streak), tone: m.streak >= DEGRADED_AFTER ? "bad" : "warn" },
      lastGood(),
      ...SCOPE_FACTS,
    ]

    if (m.streak >= DEGRADED_AFTER) {
      return {
        state: "degraded",
        summary: `${capitalise(p.why)} — ${m.streak} checks in a row, so sale-day phone alerts may not be getting through.`,
        facts,
      }
    }
    return {
      state: "unknown",
      summary: m.streak === 1
        ? `${capitalise(p.why)}. One miss isn't an outage, so this turns amber only after ${DEGRADED_AFTER} in a row.`
        : `${capitalise(p.why)}. That's ${m.streak} misses in a row; it turns amber at ${DEGRADED_AFTER}.`,
      facts,
    }
  },
}

export default ntfy
