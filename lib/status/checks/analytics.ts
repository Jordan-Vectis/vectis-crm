import { gaMetadataCheck, isGaConfigured } from "@/lib/ga"
import type { CheckResult, Fact, StatusCheckDef } from "../types"

// 🚦 Google Analytics — the vectis.co.uk visitor figures behind Marketing Reports,
// the Business Plan's snapshot and the dashboard's web-traffic tile.
//
// The check is getMetadata (via gaMetadataCheck in lib/ga.ts), with the same key and
// property Marketing Reports use. It lists the property's report fields, so it
// proves the login and the Viewer access without running a report — no visitor
// figures are read, and the reporting allowance Marketing Reports needs is left
// alone (one open of that page runs ~14 reports).
//
// ⚠ Deliberately NOT realtimeActiveUsers(): it turns every error into null, which
// would read as "nobody on the site" rather than "broken".
// ⚠ A green light cannot tell whether the website is still SENDING data. If the
// tracking tag fell off vectis.co.uk, Google would still answer happily — the
// detail panel says so rather than letting green imply it.

const CALL_TIMEOUT_MS = 12_000
/** Our own cap on top of the library's: the first call also fetches a login token. */
const HARD_TIMEOUT_MS = 15_000
const NO_FIGURES = "so Marketing Reports show no figures"

const GRPC_NAMES: Record<number, string> = {
  1: "CANCELLED", 2: "UNKNOWN", 3: "INVALID_ARGUMENT", 4: "DEADLINE_EXCEEDED", 5: "NOT_FOUND",
  7: "PERMISSION_DENIED", 8: "RESOURCE_EXHAUSTED", 9: "FAILED_PRECONDITION", 12: "UNIMPLEMENTED",
  13: "INTERNAL", 14: "UNAVAILABLE", 16: "UNAUTHENTICATED",
}

/** What a failed Analytics call means. Only Google's status NAME is shown — never its message. */
function classify(e: unknown): CheckResult {
  const err = e as { code?: unknown; message?: unknown; reason?: unknown } | null
  const msg = String(err?.message ?? "")
  const code = typeof err?.code === "number" ? err.code : null
  const reason = typeof err?.reason === "string" && /^[A-Z][A-Z0-9_]{2,60}$/.test(err.reason) ? err.reason : null
  const named = [code !== null ? GRPC_NAMES[code] ?? `code ${code}` : null, reason].filter(Boolean).join(" · ")
  const facts: Fact[] = named ? [{ label: "Google's answer", value: named, tone: "bad" }] : []

  // ⚠ Order matters. A failed LOGIN inside gRPC arrives as UNAVAILABLE ("Getting metadata
  // from plugin failed…"), which would otherwise read as Google being down — and the same
  // wrapper is used when the login server can't be reached at all, so network words first.
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|network/i.test(msg)) {
    return { state: "down", summary: `The Hub couldn't reach Google Analytics at all, ${NO_FIGURES}.`, facts }
  }
  // "No key or keyFile set" = the key setting is valid JSON but has no private_key in it.
  if (code === 16 || /invalid_grant|invalid_client|unauthorized_client|Getting metadata from plugin failed|DECODER routines|PEM|private key|client_email|No key or keyFile/i.test(msg)) {
    return { state: "down", summary: `Google refused the Analytics key on this environment (it may have been deleted, replaced or pasted wrongly), ${NO_FIGURES}.`, facts }
  }
  if (code === 7) {
    return reason === "SERVICE_DISABLED"
      ? { state: "down", summary: `The Google Analytics Data API is switched off on the key's Google project, ${NO_FIGURES}.`, facts }
      : { state: "down", summary: `Google Analytics refused the Hub access to the website's property (its account may have been removed from it), ${NO_FIGURES}.`, facts }
  }
  if (code === 5 || code === 3) {
    return { state: "down", summary: `Google Analytics doesn't recognise the property number set on this environment, ${NO_FIGURES}.`, facts }
  }
  if (code === 8) {
    return { state: "degraded", summary: "Google Analytics says the website's allowance is used up for now, so Marketing Reports may show no figures until it resets.", facts }
  }
  if (code === 4 || /deadline|timed?\s?out/i.test(msg)) {
    return { state: "down", summary: `Google Analytics didn't answer within ${CALL_TIMEOUT_MS / 1000} seconds, so Marketing Reports are likely to show no figures.`, facts }
  }
  if (code === 14) return { state: "down", summary: `Google Analytics isn't answering right now, ${NO_FIGURES}.`, facts }
  if (code !== null && code !== 1) {
    return { state: "down", summary: `Google Analytics answered with an error, so Marketing Reports may show no figures.`, facts }
  }
  return { state: "unknown", summary: "The check couldn't complete, so this couldn't be confirmed.", facts }
}

async function run(): Promise<CheckResult> {
  if (!isGaConfigured()) {
    return { state: "off", summary: "Not set up — there's no Google Analytics key or property on this environment." }
  }
  const t0 = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const r = await Promise.race([
      gaMetadataCheck(CALL_TIMEOUT_MS),
      new Promise<"timeout">(resolve => { timer = setTimeout(() => resolve("timeout"), HARD_TIMEOUT_MS) }),
    ])
    const latencyMs = Date.now() - t0
    if (r === "timeout") {
      return { state: "down", summary: `Google Analytics didn't answer within ${HARD_TIMEOUT_MS / 1000} seconds, so Marketing Reports are likely to show no figures.`, latencyMs }
    }
    if (!r.ok) {
      return {
        state: "down",
        summary: `The Google Analytics key saved on this environment is malformed, so the Hub can't log in and Marketing Reports show no figures.`,
        facts: [{ label: "What to fix", value: "GA_SERVICE_ACCOUNT_JSON on Railway must be the whole service-account key file, on one line.", tone: "bad" }],
      }
    }
    return {
      state: "ok",
      summary: "Google Analytics accepted the Hub's login and can open the website's figures.",
      facts: [
        { label: "Login", value: "Accepted by Google", tone: "good" },
        { label: "Website property", value: `Open to the Hub — ${r.dimensions} dimensions and ${r.metrics} measures listed`, tone: "good" },
        { label: "How it's checked", value: "Google's list of report fields for the property. No report is run and no visitor figures are read." },
        { label: "Not checked", value: "Whether the website is still sending visitor data — if the tracking tag fell off vectis.co.uk, this would stay green while the reports went quiet." },
      ],
      latencyMs,
    }
  } catch (e) {
    return { ...classify(e), latencyMs: Date.now() - t0 }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const analytics: StatusCheckDef = {
  key: "analytics",
  name: "Google Analytics",
  group: "suppliers",
  what: "Website visitor figures for Marketing Reports and the Business Plan.",
  whenDown: "Marketing Reports show no figures.",
  intervalMin: 30,
  run,
}

export default analytics
