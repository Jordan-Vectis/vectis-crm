import { prisma } from "@/lib/prisma"
import { bcODataUrl, getBCTokenForStatus, type BCRenewFailure, type BCStatusToken } from "@/lib/bc"
import type { CheckContext, CheckResult, Fact, StatusCheckDef } from "../types"

// 🚦 Business Central — can the Hub's BACKGROUND work read BC right now?
//
// ⚠ There is NO company-wide BC account. Every background BC job (the timed BC copy, the reconcile,
// the report caches) borrows a stored person's sign-in through getBCTokenAny(), so this check does
// the same and names WHOSE sign-in it borrowed. The page says so in words, not just a colour.
//
// ⚠ Production only. Staging and sandbox hold COPIES of production's BCToken rows, taken when their
// databases were branched (reference_sandbox_environment); renewing a copied key from a second
// place is untested with Microsoft, and the local .env IS the production database. So every other
// environment is "off" before a token is touched.
//
// ⚠ Never writes. The token comes from getBCTokenForStatus() in lib/bc.ts — a still-valid key
// first, else a renewal held in memory, most recently renewed person first — see why there.
//
// ⚠ One tiny read with its OWN 15 s timeout, not bcPage (45 s). Totes_Excel is small and already
// read by the tote sync with EVA_No; no filter, because complex filters time out in BC. With no
// filter an empty answer can only mean the wrong company/environment or lost permission.
//
// No retry inside the check: the engine only rings after two bad results in a row, and a second
// 15 s attempt would double the load on BC just when it's throttling (the 05:00 full run's top-up
// asks for five sales at once).
//
// Green means "BC answers the Hub's background key right now" — never "the copy is up to date".
// That is bc-sync's job.
//
// Whose side (types.ts `cause`): "hub" whenever the fix is ours — our BC settings, our app key, a
// person's sign-in to redo, nobody left with a renewable one, or BC saying the Hub asked for
// something it hasn't got (400/404). Left out when Microsoft's sign-in service or BC itself is down,
// slow, erroring or throttling, or when an odd answer can't be placed on either side.

const PROBE_TIMEOUT_MS = 15_000
const RENEW_TIMEOUT_MS = 6_000
const MAX_RENEWALS = 3
/** One row should come back in well under a second; this slow and the sync's 30 s pages start failing. */
const SLOW_MS = 8_000

const NOBODY = "Nobody's Business Central sign-in is usable — someone needs to press the BC button in the top bar and sign in."
const DB_UNREADABLE = "Couldn't read the stored BC sign-ins from the database, so Business Central wasn't tested."

const FAILURE_WORDS: Record<BCRenewFailure["kind"], string> = {
  "refused":      "sign-in has expired or been withdrawn — they need to sign in to BC again",
  "app-key":      "Microsoft refused the Hub's own app key",
  "unreachable":  "Microsoft's sign-in service didn't answer",
  "rate-limited": "Microsoft asked the Hub to slow down",
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** Display names for the people whose sign-ins were tried. Never selects anything but id + name. */
async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map()
  try {
    const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
    return new Map(users.filter(u => u.name?.trim()).map(u => [u.id, u.name.trim()]))
  } catch {
    return new Map() // a name is nice to have; the check still stands without it
  }
}

/** BC's own short error code ("BadRequest_ResourceNotFound"), never its message text. */
async function bcErrorCode(res: Response): Promise<string | null> {
  try {
    const parsed = JSON.parse(await res.text()) as { error?: { code?: unknown } }
    const code = parsed?.error?.code
    return typeof code === "string" && /^[\w.-]{1,80}$/.test(code) ? code : null
  } catch {
    return null
  }
}

function networkFailure(e: unknown): string {
  const err = e as { name?: string; cause?: { code?: string } } | null
  if (err?.name === "TimeoutError" || err?.name === "AbortError") {
    return `Business Central didn't answer within ${PROBE_TIMEOUT_MS / 1000} seconds.`
  }
  const code = err?.cause?.code
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "Business Central's address couldn't be looked up, so the Hub couldn't reach it."
  }
  return "The Hub couldn't connect to Business Central — the connection failed before BC answered."
}

async function run(ctx: CheckContext): Promise<CheckResult> {
  if (!ctx.isProduction) {
    return { state: "off", summary: "Checked on production only — it borrows a person's BC sign-in." }
  }
  if (!process.env.BC_TENANT_ID) {
    return { state: "down", summary: "The Hub's Business Central settings are missing on this server, so nothing can reach BC.", cause: "hub" }
  }

  // How many people have a sign-in stored. ⚠ count() with a filter — the token columns are never selected here.
  let stored = 0
  let renewable = 0
  try {
    const [a, b] = await Promise.all([
      prisma.bCToken.count(),
      prisma.bCToken.count({ where: { refreshToken: { not: "" } } }),
    ])
    stored = a
    renewable = b
  } catch {
    return { state: "unknown", summary: DB_UNREADABLE }
  }

  let pick: BCStatusToken
  try {
    pick = await getBCTokenForStatus({ maxTries: MAX_RENEWALS, timeoutMs: RENEW_TIMEOUT_MS })
  } catch {
    return { state: "unknown", summary: DB_UNREADABLE }
  }

  const names = await namesFor([...(pick.ok ? [pick.userId] : []), ...pick.failures.map(f => f.userId)])
  const nameOf = (id: string) => names.get(id) ?? "a person whose name couldn't be read"
  const signInOf = (id: string) => (names.has(id) ? `${names.get(id)}'s sign-in` : "a stored sign-in")

  const facts: Fact[] = []
  if (pick.ok) {
    facts.push({ label: "Sign-in used", value: `${nameOf(pick.userId)} — ${pick.renewed ? "renewed for this check" : "still valid"}` })
  }
  facts.push({
    label: "People with a renewable BC sign-in",
    value: stored > renewable ? `${renewable} (of ${stored} stored)` : String(renewable),
    tone: renewable === 0 ? "bad" : renewable === 1 ? "warn" : undefined,
  })
  for (const f of pick.failures) {
    facts.push({
      label: "Couldn't renew",
      value: `${nameOf(f.userId)}: ${FAILURE_WORDS[f.kind]} (${f.code})`,
      tone: f.kind === "rate-limited" ? "warn" : "bad",
    })
  }
  const background: Fact = { label: "Background BC work", value: "Borrows one person's sign-in — there is no company BC account" }

  // ── No key to try ─────────────────────────────────────────────────────────────────────────────
  if (!pick.ok) {
    facts.push(background)
    const last = pick.failures[pick.failures.length - 1]
    if (pick.reason === "not-configured") {
      return { state: "down", summary: "The Hub's Business Central app settings are missing on this server, so no sign-in can be renewed.", facts, cause: "hub" }
    }
    if (last?.kind === "app-key") {
      // Our app registration's secret, not Microsoft failing — Microsoft is answering, and saying no.
      return { state: "down", summary: "Microsoft refused the Hub's own app key, so nobody's BC sign-in can be renewed — it has probably expired and needs renewing in Microsoft Entra.", facts, cause: "hub" }
    }
    if (last?.kind === "unreachable") {
      return { state: "down", summary: "Microsoft's sign-in service didn't answer, so the Hub couldn't get into Business Central.", facts }
    }
    if (last?.kind === "rate-limited") {
      return { state: "degraded", summary: "Microsoft is limiting how often the Hub can renew BC sign-ins — it should clear on its own.", facts }
    }
    if (pick.reason === "renewals-failed" && renewable > pick.failures.length) {
      // Older sign-ins exist but weren't tried — don't claim "nobody" when that hasn't been shown.
      return {
        state: "down",
        summary: `None of the ${pick.failures.length} most recently used BC sign-ins can be renewed — someone needs to press the BC button in the top bar and sign in.`,
        facts,
        cause: "hub",
      }
    }
    // Every remaining way here is ours: no sign-in stored, none renewable, or the last one refused.
    return { state: "down", summary: NOBODY, facts, cause: "hub" }
  }

  // ── One tiny read ─────────────────────────────────────────────────────────────────────────────
  const who = signInOf(pick.userId)
  const started = Date.now()
  let res: Response
  try {
    res = await fetch(`${bcODataUrl("Totes_Excel")}?$top=1&$select=EVA_No`, {
      headers: {
        Accept:             "application/json",
        "OData-MaxVersion": "4.0",
        Authorization:      `Bearer ${pick.token}`,
      },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch (e) {
    facts.push(background)
    return { state: "down", summary: networkFailure(e), facts }
  }
  const ms = Date.now() - started
  facts.push({ label: "Answer time", value: fmtMs(ms), tone: ms > SLOW_MS ? "warn" : undefined })

  if (!res.ok) {
    const code = await bcErrorCode(res)
    facts.push({ label: "BC answered", value: `Error ${res.status}${code ? ` (${code})` : ""}`, tone: res.status === 429 ? "warn" : "bad" })
    facts.push(background)
    const s = res.status
    if (s === 429) {
      return { state: "degraded", summary: "Business Central is limiting how often the Hub can ask (too many requests) — it should clear on its own.", facts, latencyMs: ms }
    }
    const summary =
      s === 401 ? `Business Central refused ${who} — they may need to press the BC button in the top bar and sign in again.`
      : s === 403 ? `${who[0].toUpperCase()}${who.slice(1)} isn't allowed to read Business Central's tote list — their BC permissions may have changed.`
      : s === 404 ? "Business Central couldn't find the tote list — the Hub's environment or company setting, or BC's published web services, have changed."
      : s === 400 ? "Business Central rejected the Hub's request — its settings or the tote list's layout may have changed."
      : s >= 500 ? `Business Central is having problems at Microsoft's end (error ${s}).`
      : `Business Central answered with an unexpected error (${s}).`
    // ⚠ BC ANSWERED, so none of these four is Microsoft failing: 401/403 are our borrowed sign-in
    // refused, 400/404 the Hub asking for something BC hasn't got (BC_ENVIRONMENT / BC_COMPANY, or a
    // layout the Hub no longer matches). Only a 5xx, or a code nobody can place, stays on BC's side.
    const hubSide = s === 401 || s === 403 || s === 404 || s === 400
    return { state: "down", summary, facts, latencyMs: ms, ...(hubSide ? { cause: "hub" as const } : {}) }
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch (e) {
    // ⚠ The 15 s timer also covers reading the body. A read cut off by it is BC not answering in
    // time, not "the wrong answer" — say so rather than blame the tote list's layout.
    const name = (e as { name?: string } | null)?.name
    if (name === "TimeoutError" || name === "AbortError") {
      facts.push(background)
      return { state: "down", summary: networkFailure(e), facts, latencyMs: ms }
    }
    body = null
  }
  const rows = (body as { value?: unknown } | null)?.value
  if (!Array.isArray(rows)) {
    facts.push(background)
    return { state: "down", summary: "Business Central answered, but not with the tote list the Hub asked for.", facts, latencyMs: ms }
  }
  if (rows.length === 0) {
    facts.push(background)
    return {
      state: "down",
      summary: `Business Central answered but sent no totes — the Hub's company or environment setting may be wrong, or ${who} may have lost access.`,
      facts,
      latencyMs: ms,
      cause: "hub", // unfiltered, so empty can only be our settings or our borrowed sign-in's access
    }
  }
  const toteNo = String((rows[0] as { EVA_No?: unknown } | null)?.EVA_No ?? "").trim()
  if (!toteNo) {
    facts.push(background)
    return { state: "down", summary: "Business Central sent a tote with no number — the tote list's layout may have changed.", facts, latencyMs: ms }
  }
  facts.push(background)

  // ── BC answered properly — anything still worth an amber? ─────────────────────────────────────
  if (ms > SLOW_MS) {
    return { state: "degraded", summary: `Business Central is answering, but slowly — ${fmtMs(ms)} for a single tote.`, facts, latencyMs: ms }
  }
  if (!pick.renewed && renewable === 0) {
    // Working on a key someone used in the last hour, which nothing can renew once it runs out.
    return {
      state: "degraded",
      summary: `Business Central is answering, but no stored sign-in can be renewed — background BC work stops when ${who} runs out, within the hour.`,
      facts,
      latencyMs: ms,
      cause: "hub", // BC is fine; someone needs to sign in again
    }
  }
  const refused = pick.failures.filter(f => f.kind === "refused")
  if (refused.length) {
    // ⚠ getBCTokenAny picks a refreshable row ARBITRARILY and tries only that one, so a dead row
    // left in the table can be the one the timed copy lands on.
    const dead = refused.map(f => nameOf(f.userId)).join(", ")
    return {
      state: "degraded",
      summary: `Business Central is answering, but ${dead}'s stored sign-in no longer renews — the timed BC copy can pick it and fail until they sign in again.`,
      facts,
      latencyMs: ms,
      cause: "hub", // BC is fine; a person's sign-in needs redoing
    }
  }
  return { state: "ok", summary: `Business Central answered in ${fmtMs(ms)} using ${who}.`, facts, latencyMs: ms }
}

const bcApi: StatusCheckDef = {
  key: "bc-api",
  name: "Business Central",
  group: "business-central",
  what: "Vectis's main business system — receipts, lots, totes and customers.",
  whenDown: "Live BC figures, tote lookups and the overnight BC copy stop working.",
  statusPage: "https://status.cloud.microsoft",
  intervalMin: 15,
  // Up to three 6 s renewals (only when every stored key has lapsed) plus the 15 s read.
  timeoutMs: 40_000,
  run,
}

export default bcApi
