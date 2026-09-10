import type { CheckResult, Fact, StatusCheckDef } from "../types"

// 🚦 D-ID — the talking presenter on the AI Presenter tool (/tools/avatar).
//
// The check makes exactly the call the tool makes every time the page opens:
// GET /clips/presenters?limit=20, with the Authorization header built the same way
// (app/api/avatar/route.ts didAuth). So a pass here is the tool's own first step passing.
//
// ⚠⚠ NEVER POST /clips/streams (or /sdp, /ice, /keepalive, or the speak call). Those open and drive
// a streaming session, which D-ID bills for. That is why the check can't prove a live stream will
// start — the plan can still refuse one — and says so in its facts.
//
// ⚠ GET /credits is D-ID's documented balance endpoint but the Hub doesn't use it anywhere, and
// nothing shows streams draw on that balance, so it isn't read here (research reviewer, 2026-09-10).

const DID_API = "https://api.d-id.com" // same as app/api/avatar/route.ts
const TIMEOUT_MS = 12_000

/** ⚠ Built exactly as didAuth() in app/api/avatar/route.ts: the env value is ALREADY the
 *  "base64email:secret" string D-ID issues, and it is base64-encoded again as a whole. */
function didAuth(key: string): string {
  return `Basic ${Buffer.from(key).toString("base64")}`
}

function netFailure(e: unknown): "timeout" | "dns" | "network" {
  const err = e as { name?: string; code?: string; cause?: { name?: string; code?: string } } | null
  if (err?.name === "TimeoutError" || err?.name === "AbortError" || err?.cause?.name === "TimeoutError") return "timeout"
  const code = err?.cause?.code ?? err?.code
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns"
  return "network"
}

const NOTE: Fact = {
  label: "What green means",
  value: "D-ID accepted the Hub's key and listed its presenters. Starting a live stream is only proven when someone uses the tool — a stream is paid for, so the check never opens one.",
}

const check: StatusCheckDef = {
  key: "did",
  name: "D-ID presenter",
  group: "suppliers",
  what: "The talking presenter on the AI Presenter tool.",
  whenDown: "The presenter won't start.",
  statusPage: "https://status.d-id.com",
  intervalMin: 30,

  async run(): Promise<CheckResult> {
    const key = process.env.DID_API_KEY
    if (!key) {
      return { state: "off", summary: "Not set up here: there's no D-ID key on this environment, so the presenter can't be used from it." }
    }

    const t0 = Date.now()
    let res: Response
    let text: string
    try {
      res = await fetch(`${DID_API}/clips/presenters?limit=20`, {
        headers: { Authorization: didAuth(key) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      })
      text = await res.text().catch(() => "")
    } catch (e) {
      const reason = netFailure(e)
      const summary =
        reason === "timeout" ? `D-ID didn't answer within ${TIMEOUT_MS / 1000} seconds, so the presenter won't start right now.`
        : reason === "dns"   ? "Couldn't find D-ID's system at all (its address didn't look up), so the presenter won't start."
        :                      "Couldn't connect to D-ID, so the presenter won't start right now."
      return { state: "down", summary, facts: [{ label: "D-ID", value: "Not answering", tone: "bad" }, NOTE] }
    }
    const ms = Date.now() - t0
    const status = res.status

    if (res.ok) {
      let body: unknown
      try { body = JSON.parse(text) } catch { body = undefined }
      // The route reads `data.presenters ?? data`, so accept either shape the same way.
      const b = body as { presenters?: unknown } | unknown[] | undefined
      const list = Array.isArray(b) ? b : Array.isArray((b as { presenters?: unknown } | undefined)?.presenters) ? (b as { presenters: unknown[] }).presenters : null
      if (!list) {
        return {
          state: "unknown",
          summary: "Couldn't confirm — D-ID answered, but not with a list of presenters the check recognises.",
          facts: [{ label: "D-ID answered", value: `HTTP ${status}, not the expected shape`, tone: "warn" }, NOTE],
          latencyMs: ms,
        }
      }
      if (list.length === 0) {
        return {
          state: "degraded",
          summary: "D-ID accepted the key but offered no presenters, so the tool has nobody to show.",
          facts: [{ label: "Key", value: "Accepted", tone: "good" }, { label: "Presenters available", value: "None", tone: "warn" }, NOTE],
          latencyMs: ms,
        }
      }
      // limit=20 caps the list, so 20 means "at least 20".
      const n = list.length >= 20 ? "20 or more" : String(list.length)
      return {
        state: "ok",
        summary: `D-ID accepted the Hub's key and is answering — ${n} presenters available.`,
        facts: [{ label: "Key", value: "Accepted", tone: "good" }, { label: "Presenters available", value: n }, NOTE],
        latencyMs: ms,
      }
    }

    if (status === 401 || status === 403) {
      return {
        state: "down",
        summary: "D-ID refused the Hub's key, so the presenter won't start.",
        facts: [
          { label: "Key", value: `Refused (${status})`, tone: "bad" },
          // ⚠ The format trap in route.ts: pasted any other way it looks set but is refused.
          { label: "Worth checking", value: "The key must be pasted exactly as D-ID shows it: one piece of text with a colon in the middle, nothing added or trimmed. The plan or trial may also have ended." },
          NOTE,
        ],
        latencyMs: ms,
      }
    }
    if (status === 402) {
      return {
        state: "down",
        summary: "D-ID refused the account (payment required) — the plan or credits may have run out.",
        facts: [{ label: "D-ID", value: "Payment required (402)", tone: "bad" }, NOTE],
        latencyMs: ms,
      }
    }
    if (status === 404) {
      // Exactly the address the tool itself calls, so if it has gone the tool fails the same way.
      return {
        state: "down",
        summary: "D-ID's presenter list has moved or gone, so the presenter won't start.",
        facts: [{ label: "D-ID", value: "Not found (404)", tone: "bad" }, NOTE],
        latencyMs: ms,
      }
    }
    if (status === 429) {
      return {
        state: "degraded",
        summary: "D-ID is limiting how often the Hub can ask, so the presenter may be refused for a few minutes.",
        facts: [{ label: "D-ID", value: "Rate limited (429)", tone: "warn" }, NOTE],
        latencyMs: ms,
      }
    }
    if (status >= 500) {
      return {
        state: "down",
        summary: `D-ID's system is answering with an error (${status}), so the presenter won't start right now.`,
        facts: [{ label: "D-ID", value: `Error ${status}`, tone: "bad" }, NOTE],
        latencyMs: ms,
      }
    }
    return {
      state: "unknown",
      summary: "Couldn't confirm — this check needs looking at.",
      facts: [{ label: "D-ID answered", value: `HTTP ${status} — not what the check expected`, tone: "warn" }, NOTE],
      latencyMs: ms,
    }
  },
}

export default check
