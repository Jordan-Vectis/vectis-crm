// 🚦 Passive signals for the Status Centre — things the Hub notices while doing
// real work, which no probe could measure without side effects.
//
// ⚠ Kept on globalThis, not in module variables: Next can load a module more than
// once (one copy per route bundle), and server.js shares state with route handlers
// the same way (globalThis._io). Also deliberately IN MEMORY: while the database is
// refusing writes, it's the one place a refused write can still be recorded.
// Lost on restart, which is fine — these describe the last few hours, not history.

type AiOutcome = {
  at: number
  provider: "gemini" | "anthropic"
  model: string
  outcome: "ok" | "rate_limited" | "error"
  /** A short machine word for the error, e.g. "429", "404", "blocked". Never message text with keys in it. */
  kind?: string
}

type Signals = {
  refusedWrites: number[]      // timestamps of saves the database refused (SQLSTATE 25006)
  ai: AiOutcome[]              // most recent AI call outcomes
}

const MAX_KEEP = 500

function store(): Signals {
  const g = globalThis as unknown as { _statusSignals?: Signals }
  return (g._statusSignals ??= { refusedWrites: [], ai: [] })
}

/** Call wherever a real save was refused because the database is read-only. Never throws. */
export function noteRefusedWrite(): void {
  try {
    const s = store()
    s.refusedWrites.push(Date.now())
    if (s.refusedWrites.length > MAX_KEEP) s.refusedWrites.splice(0, s.refusedWrites.length - MAX_KEEP)
  } catch { /* a signal must never break the save path it sits in */ }
}

/** Timestamps (ms) of refused saves at or after `sinceMs`. */
export function refusedWritesSince(sinceMs: number): number[] {
  return store().refusedWrites.filter(t => t >= sinceMs)
}

/** Call after a real AI request finishes. Never throws. */
export function noteAiOutcome(o: Omit<AiOutcome, "at">): void {
  try {
    const s = store()
    s.ai.push({ ...o, at: Date.now() })
    if (s.ai.length > MAX_KEEP) s.ai.splice(0, s.ai.length - MAX_KEEP)
  } catch { /* never break the AI call */ }
}

/** AI outcomes at or after `sinceMs`, optionally for one provider. */
export function aiOutcomesSince(sinceMs: number, provider?: AiOutcome["provider"]): AiOutcome[] {
  return store().ai.filter(o => o.at >= sinceMs && (!provider || o.provider === provider))
}
