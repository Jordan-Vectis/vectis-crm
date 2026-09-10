// Small retry wrapper for one-shot Gemini calls. 503 / overloaded errors are
// transient (per RULES: retry, never surface as permanent failure) — retry a
// couple of times with a short wait before giving up with a friendly message.

import { noteAiOutcome } from "@/lib/status/signals"

export function isTransientGeminiError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e ?? "")
  return /\b503\b|service unavailable|overloaded|try again later|deadline exceeded/i.test(msg)
}

// 429 / quota exhaustion — a distinct failure that needs a longer back-off than
// a transient 503 (rate-limit windows are per-minute, not per-second).
export function isRateLimitError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e ?? "")
  return /\b429\b|resource[ _]?exhausted|rate[ _]?limit|too many requests|\bquota\b/i.test(msg)
}

// Map a Gemini failure to something a person can act on, or null to let the
// caller surface its own message. Google's own text is unusable in a UI — a
// quota failure arrives as a wall of "generativelanguage.googleapis.com …
// GenerateRequestsPerMinutePerProjectPerUser …", which is what was leaking into
// the chat. Only the two noisy, expected classes are translated; anything else
// keeps its real message so genuine bugs stay diagnosable.
export function friendlyGeminiError(e: unknown): { error: string; status: number } | null {
  if (isRateLimitError(e)) {
    return {
      error: "Google's AI is rate-limited right now (too many requests in a short time) — wait a minute and try again, or switch model.",
      status: 429,
    }
  }
  if (isTransientGeminiError(e)) {
    return { error: "That model is overloaded right now — try again in a minute, or switch model.", status: 503 }
  }
  return null
}

// 🚦 A short machine word for how a Gemini request went wrong, for the Status
// Centre's passive AI signal (lib/status/signals.ts): "429", "503", "404",
// "blocked", "timeout", "network" or "other".
// ⚠ Never the message itself — Google's errors quote the request URL, and the
// older routes still put the key in that URL (?key=…).
// ⚠ A content block is Google ANSWERING, not failing: it comes back as "blocked"
// so the Status Centre never counts refused lots as an outage.
export function geminiErrorKind(e: unknown): string {
  try {
    if (isRateLimitError(e)) return "429"
    const err = e as { status?: unknown; name?: unknown; message?: unknown } | null
    const msg = String(err?.message ?? e ?? "")
    const s = err?.status
    // The SDK's fetch errors carry .status; others only say "[503 Service Unavailable]".
    const status = typeof s === "number" ? s : Number(/\[(\d{3})\s/.exec(msg)?.[1])
    if (status >= 400 && status <= 599) return String(status)
    if (/\bblocked\b|finishReason|\bSAFETY\b|RECITATION|PROHIBITED|BLOCKLIST|MALFORMED_FUNCTION_CALL/i.test(msg)) return "blocked"
    if (err?.name === "AbortError" || /abort|timed?\s?out|deadline/i.test(msg)) return "timeout"
    if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|socket hang up|network/i.test(msg)) return "network"
    if (isTransientGeminiError(e)) return "503"
    return "other"
  } catch {
    return "other"
  }
}

export async function withGeminiRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const out = await fn()
      // 🚦 Every attempt is a real request to Google, so each is recorded — a 429
      // that a retry then got past still counts as a refusal. The model isn't
      // known here (the callers build it inside `fn`), hence the blank.
      noteAiOutcome({ provider: "gemini", model: "", outcome: "ok" })
      return out
    } catch (e) {
      lastErr = e
      const rate = isRateLimitError(e)
      noteAiOutcome({ provider: "gemini", model: "", outcome: rate ? "rate_limited" : "error", kind: geminiErrorKind(e) })
      if ((!isTransientGeminiError(e) && !rate) || attempt === attempts) throw e
      // Rate limits get a longer wait than transient 503s.
      await new Promise((r) => setTimeout(r, rate ? Math.min(8000 * attempt, 24000) : 1500 * attempt))
    }
  }
  throw lastErr
}
