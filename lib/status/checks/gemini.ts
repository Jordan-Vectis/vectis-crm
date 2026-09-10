import { prisma } from "@/lib/prisma"
import { AI_TOOLS, CLAUDE_MODELS, FALLBACK_SLOT, getToolModel, slotSupportsClaude } from "@/lib/ai-models"
import { aiOutcomesSince } from "../signals"
import type { CheckContext, CheckResult, Fact, StatusCheckDef } from "../types"

// 🚦 Gemini AI — Google's AI, behind almost every AI button in the Hub.
//
// Two halves, because neither is enough on its own:
//  1. ACTIVE, and free: Google's model list, fetched with the key. A 200 proves the
//     key is accepted and the Google project is alive. Then every model the SERVER
//     would pick is looked up in it — on 2026-06-29 a retired model (gemini-2.0-flash)
//     404'd four tools while the key itself was perfectly fine.
//  2. PASSIVE: how Google answered the Hub's REAL requests in the last 30 minutes
//     (lib/status/signals.ts, recorded by lib/ai-provider.ts and withGeminiRetry).
//     The model list answers happily while every generate request is refused for
//     going over the allowance (2026-08-19), and this is the only way to see that.
//
// ⚠⚠ NEVER a generate call. The whole Google project gets 4 generate requests a
// minute, shared by every tool and every environment, so a check that asked for an
// answer would spend the very allowance it is measuring. The Model Tester
// (app/api/auction-ai/model-test) makes exactly such a call — don't reuse it.
// ⚠ The key goes in the x-goog-api-key HEADER, never ?key= in the URL: URLs end up
// in error messages and logs.
//
// The small helpers below are exported for claude.ts, which needs the same slot
// maths and the same passive tally.

const API = "https://generativelanguage.googleapis.com/v1beta"
const REQUEST_TIMEOUT_MS = 10_000
/** Everything Google-side must be finished by then — the engine abandons a check at 25 s. */
const BUDGET_MS = 20_000
const DB_TIMEOUT_MS = 8_000
const MAX_PAGES = 5
/** Follow-up lookups for names missing from the list — bounded, one at a time. */
const MAX_CONFIRM = 8
const WINDOW_MS = 30 * 60_000
/** ⚠ One or two refusals are ordinary: the project gets 4 generate requests a minute, so
 *  two people using AI at once collide. Three in half an hour is a pattern, not a blip. */
export const REFUSALS_FOR_AMBER = 3
export const FAILURES_FOR_AMBER = 3

// ── Shared helpers (also used by claude.ts) ─────────────────────────────────────

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export const isClaudeId = (id: string | null | undefined) => (id ?? "").trim().toLowerCase().startsWith("claude-")

/** "A, B and C" · "A, B, C and 4 more". */
export function listNames(names: string[], max = 3): string {
  const u = [...new Set(names)]
  if (u.length <= 1) return u[0] ?? ""
  if (u.length <= max) return `${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}`
  return `${u.slice(0, max).join(", ")} and ${u.length - max} more`
}

/** London time, e.g. "today at 14:32" or "Tue 8 Sept at 22:10". */
export function fmtWhen(ms: number, nowMs: number): string {
  const tz = "Europe/London"
  const day = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t))
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(ms))
  if (day(ms) === day(nowMs)) return `today at ${time}`
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(ms))
  return `${date} at ${time}`
}

/**
 * Resolves to `fallback` if `p` hasn't settled within `ms`, or if it fails.
 * ⚠ The database is one of the things the Status Centre checks (2026-09-09): a hung
 * read here must not drag the whole check past the engine's cap and lose the
 * supplier's answer with it.
 */
export function within<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race<T | F>([
    p.catch(() => fallback),
    new Promise<F>(resolve => { timer = setTimeout(() => resolve(fallback), ms) }),
  ]).finally(() => { if (timer) clearTimeout(timer) })
}

export type SlotModel = {
  slot: string
  label: string
  /** The raw Admin → AI Models row, or null when the tool is on its built-in default. */
  configured: string | null
  /** What getToolModel(slot) picks when the browser sends no model of its own. */
  model: string
  provider: "gemini" | "anthropic"
  /** Why a Claude model set for this tool is NOT being used (it quietly runs on its Gemini default). */
  claudeSkipped?: "no-key" | "slot-cannot" | "unknown-model"
}

const CLAUDE_IDS = new Set(CLAUDE_MODELS.map(m => m.id))

/**
 * The model each tool will actually use, worked out the way getToolModel() does in
 * lib/ai-models.ts: the configured row if usable() allows it, otherwise the slot's
 * built-in default. Keep in step with usable() if that ever changes.
 * ⚠ From a DIRECT read of ToolModel, never getToolModel itself: its loadConfig
 * swallows a database error and quietly answers with the built-in defaults, so on a
 * day the database is failing this light would check the wrong models and show green.
 */
export function resolveSlots(rows: Map<string, string>): SlotModel[] {
  const hasKey = !!process.env.ANTHROPIC_API_KEY
  return AI_TOOLS.map(t => {
    const configured = rows.get(t.slot) ?? null
    let model = t.default
    let claudeSkipped: SlotModel["claudeSkipped"]
    if (configured) {
      if (!isClaudeId(configured)) model = configured
      else if (!CLAUDE_IDS.has(configured)) claudeSkipped = "unknown-model"
      else if (!slotSupportsClaude(t.slot)) claudeSkipped = "slot-cannot"
      else if (!hasKey) claudeSkipped = "no-key"
      else model = configured
    }
    return { slot: t.slot, label: t.label, configured, model, provider: isClaudeId(model) ? "anthropic" : "gemini", claudeSkipped }
  })
}

/** Admin → AI Models rows (slot → model id, the fallback under "_fallback"), or null when they
 *  can't be read. Blank rows are dropped exactly as loadConfig drops them. */
export async function readToolModels(): Promise<Map<string, string> | null> {
  return within(
    prisma.toolModel.findMany({ select: { slot: true, modelId: true } })
      .then(rows => new Map(rows.filter(r => r.modelId).map(r => [r.slot, r.modelId] as [string, string]))),
    DB_TIMEOUT_MS,
    null,
  )
}

export type AiTally = {
  answered: number
  refused: number
  failed: number
  /** Errors that were the Hub's own doing or unclassified — shown, never counted against the supplier. */
  other: number
  failedKinds: Record<string, number>
  lastAnswerAt: number | null
  /** The newest outcome inside the window. */
  latest: { outcome: string; kind?: string; at: number } | null
}

/** Kinds that mean the SUPPLIER failed. "blocked" is a content refusal — the supplier ANSWERED —
 *  and "400"/"other" are nearly always a problem with what the Hub sent. Neither is an outage,
 *  so neither may turn a light amber. */
const supplierFailure = (kind?: string) =>
  !!kind && (/^5\d\d$/.test(kind) || ["timeout", "network", "401", "403", "404", "credit"].includes(kind))

export function tallyAi(provider: "gemini" | "anthropic", nowMs: number): AiTally {
  const t: AiTally = { answered: 0, refused: 0, failed: 0, other: 0, failedKinds: {}, lastAnswerAt: null, latest: null }
  const recent = aiOutcomesSince(nowMs - WINDOW_MS, provider)
  for (const o of recent) {
    if (o.outcome === "ok" || o.kind === "blocked") t.answered++
    else if (o.outcome === "rate_limited") t.refused++
    else if (o.kind && supplierFailure(o.kind)) { t.failed++; t.failedKinds[o.kind] = (t.failedKinds[o.kind] ?? 0) + 1 }
    else t.other++
  }
  const newest = recent[recent.length - 1]
  if (newest) t.latest = { outcome: newest.outcome, kind: newest.kind, at: newest.at }
  // The last answer can be older than the window — the buffer keeps the last 500 requests.
  const all = aiOutcomesSince(0, provider)
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].outcome === "ok" || all[i].kind === "blocked") { t.lastAnswerAt = all[i].at; break }
  }
  return t
}

/** Why most of the failures happened, in words. */
export function failureReason(kinds: Record<string, number>, who: string): string {
  const top = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""
  if (top === "credit") return `${who} said the account is out of credit`
  if (top === "timeout" || top === "network") return `${who} didn't answer`
  if (top === "404") return `${who} said the model doesn't exist`
  if (top === "401" || top === "403") return `${who} refused the key`
  if (top === "529") return `${who} was overloaded`
  return `${who} was overloaded or failing`
}

export function tallyFact(t: AiTally, refusedWords: string): Fact {
  const label = "Requests in the last 30 minutes"
  const total = t.answered + t.refused + t.failed + t.other
  if (!total) return { label, value: "None — nothing has used it in that time, so there's nothing to judge by." }
  const bits = [`${t.answered} answered`, `${t.refused} ${refusedWords}`, `${t.failed} failed`]
  if (t.other) bits.push(`${t.other} other ${plural(t.other, "error", "errors")}, not counted`)
  const tone = t.refused >= REFUSALS_FOR_AMBER || t.failed >= FAILURES_FOR_AMBER ? "warn" : t.refused || t.failed ? undefined : "good"
  return { label, value: bits.join(" · "), tone }
}

export function lastAnswerFact(t: AiTally, who: string, nowMs: number): Fact {
  // In memory, so it starts again at every restart or deploy — said so rather than implying "never".
  return { label: `Last answer from ${who}`, value: t.lastAnswerAt ? fmtWhen(t.lastAnswerAt, nowMs) : "None since the Hub last restarted" }
}

// ── Talking to Google ───────────────────────────────────────────────────────────

type GoogleOk = { ok: true; body: unknown; ms: number }
type GoogleFail = { ok: false; status: number | null; reason: string | null; failure: "timeout" | "network" | "http"; ms: number }

/** Google's short reason CODE (API_KEY_INVALID, SERVICE_DISABLED…) — never its message text. */
function googleReason(body: unknown): string | null {
  const err = (body as { error?: { status?: unknown; details?: unknown } } | null)?.error
  const details = Array.isArray(err?.details) ? (err!.details as { reason?: unknown }[]) : []
  const code = [...details.map(d => d?.reason), err?.status].find(c => typeof c === "string" && /^[A-Z][A-Z0-9_]{2,60}$/.test(c))
  return typeof code === "string" ? code : null
}

async function googleGet(url: string, key: string, deadline: number): Promise<GoogleOk | GoogleFail> {
  const t0 = Date.now()
  const budget = Math.max(1_000, Math.min(REQUEST_TIMEOUT_MS, deadline - t0))
  try {
    const res = await fetch(url, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(budget), cache: "no-store" })
    const body: unknown = await res.json().catch(() => null)
    if (res.ok) return { ok: true, body, ms: Date.now() - t0 }
    return { ok: false, status: res.status, reason: googleReason(body), failure: "http", ms: Date.now() - t0 }
  } catch (e) {
    const name = (e as { name?: unknown } | null)?.name
    return { ok: false, status: null, reason: null, failure: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network", ms: Date.now() - t0 }
  }
}

/** Every model name Google offers this key. `complete` is false when paging stopped early. */
async function listModels(key: string, deadline: number): Promise<{ ok: true; names: Set<string>; complete: boolean; ms: number } | GoogleFail> {
  const names = new Set<string>()
  let pageToken = ""
  let ms = 0
  let complete = false
  // ⚠ pageSize=1000 AND follow nextPageToken: the Admin → AI Models route sends no pageSize,
  // gets Google's default of 50, and a model past the first page would look missing here.
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await googleGet(`${API}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, key, deadline)
    if (page === 0) ms = r.ms
    if (!r.ok) return r
    const body = r.body as { models?: { name?: unknown }[]; nextPageToken?: unknown } | null
    for (const m of body?.models ?? []) {
      const n = bareModel(String(m?.name ?? ""))
      if (n) names.add(n)
    }
    pageToken = typeof body?.nextPageToken === "string" ? body.nextPageToken : ""
    if (!pageToken) { complete = true; break }
    if (Date.now() > deadline - 3_000) break
  }
  return { ok: true, names, complete, ms }
}

/** Google names models "models/gemini-…"; the Hub stores them without the prefix (the SDK accepts both). */
const bareModel = (id: string) => id.trim().replace(/^models\//, "")

/** What a failed model-list request means for the Hub. */
function listFailure(r: GoogleFail): CheckResult {
  const facts: Fact[] = r.reason ? [{ label: "Google's reason", value: r.reason, tone: "bad" }] : []
  if (r.failure === "timeout") {
    return { state: "down", summary: `Google's AI service didn't answer within ${REQUEST_TIMEOUT_MS / 1000} seconds, so AI buttons are likely to fail.`, facts, latencyMs: r.ms }
  }
  if (r.failure === "network") {
    return { state: "down", summary: "The Hub couldn't reach Google's AI service at all, so AI buttons fail.", facts }
  }
  const s = r.status ?? 0
  // Google answers a bad key with 400 API_KEY_INVALID, not 401 — hence the reason test.
  if (s === 401 || s === 403 || (s === 400 && /API_KEY/.test(r.reason ?? ""))) {
    return {
      state: "down",
      summary: r.reason === "SERVICE_DISABLED"
        ? "Google has AI switched off for the Hub's Google project, so every AI button fails."
        : "Google refused the Gemini key, so every AI button fails.",
      facts, latencyMs: r.ms,
    }
  }
  // Google's answer when it won't serve the Gemini API to the project at all — typically billing
  // not set up on the Google project, or the server's region not supported. Not the check's fault.
  if (s === 400 && r.reason === "FAILED_PRECONDITION") {
    return { state: "down", summary: "Google won't serve its AI to the Hub's Google project (usually a billing or location problem), so every AI button fails.", facts, latencyMs: r.ms }
  }
  if (s === 429) return { state: "degraded", summary: "Google is rate-limiting the Hub right now — even the free model list was refused.", facts, latencyMs: r.ms }
  if (s === 404) return { state: "down", summary: "Google's AI model list has moved or gone, so the Hub's AI connection needs attention.", facts, latencyMs: r.ms }
  if (s >= 500) return { state: "down", summary: `Google's AI service is failing — it answered the Hub with error ${s}.`, facts, latencyMs: r.ms }
  return { state: "unknown", summary: `Google turned down the check's own request (error ${s}), so this couldn't be confirmed.`, facts, latencyMs: r.ms }
}

/**
 * True when `id` is on the Hub's own retired list (RETIRED_MODELS, private to
 * lib/ai-models.ts). getToolModel ignores a retired model offered by the browser, so
 * offering `id` to a tool that is set to something else shows whether it's on the
 * list — a pure lookup, nothing is saved. A stale config cache can only make this
 * answer "no", never a false "yes".
 */
async function onHubRetiredList(id: string, slots: SlotModel[], deadline: number): Promise<boolean> {
  const probe = slots.find(s => s.provider === "gemini" && s.model !== id && s.configured !== id)
  if (!probe) return false
  // Bounded by what's left of the budget: getToolModel reads the settings for a retired name,
  // and a hung database must not push the whole check past the engine's 25-second cap.
  const ms = Math.max(500, Math.min(DB_TIMEOUT_MS, deadline + 3_000 - Date.now()))
  return (await within(getToolModel(probe.slot, id), ms, id)) !== id
}

// ── The check ───────────────────────────────────────────────────────────────────

async function run(ctx: CheckContext): Promise<CheckResult> {
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    return ctx.isProduction
      ? { state: "down", summary: "No Gemini key is set on the live Hub, so every AI button fails." }
      : { state: "off", summary: "Not set up — there's no Gemini key on this environment, so AI tools won't work here." }
  }
  const nowMs = ctx.now.getTime()
  const deadline = Date.now() + BUDGET_MS
  // lib/condition-extract.ts: this server setting beats the condition_extract slot outright.
  const envCondition = (process.env.CONDITION_AI_MODEL ?? "").trim()

  const [catalogue, config, disabled, queue] = await Promise.all([
    listModels(key, deadline),
    readToolModels(),
    within(prisma.disabledModel.findMany({ select: { modelId: true } }).then(r => new Set(r.map(d => d.modelId))), DB_TIMEOUT_MS, null),
    // ⚠ Only where the overnight runner actually runs: staging and sandbox hold COPIES of
    // production's queue, frozen the day they were made.
    ctx.backgroundJobsExpected
      ? within(prisma.pipelineQueueItem.findMany({
          where: { status: { in: ["QUEUED", "RUNNING", "PAUSED"] } },
          select: { code: true, model: true, fallbackModel: true },
          orderBy: { position: "asc" },
          take: 100,
        }), DB_TIMEOUT_MS, null)
      : Promise.resolve(null),
  ])
  const tally = tallyAi("gemini", nowMs)
  const passiveFacts = [tallyFact(tally, "refused for going over the allowance"), lastAnswerFact(tally, "Google", nowMs)]

  if (!catalogue.ok) {
    const r = listFailure(catalogue)
    return { ...r, facts: [...(r.facts ?? []), ...passiveFacts] }
  }
  const latencyMs = catalogue.ms
  if (catalogue.names.size === 0) {
    return { state: "unknown", summary: "Google accepted the key but listed no AI models at all, so the models couldn't be checked.", facts: passiveFacts, latencyMs }
  }

  // ── Every Gemini model the server will call, and who uses it ──
  type Use = { tools: string[]; fallback: boolean; condition: boolean; sales: string[] }
  const uses = new Map<string, Use>()
  const use = (id: string): Use => {
    let u = uses.get(id)
    if (!u) { u = { tools: [], fallback: false, condition: false, sales: [] }; uses.set(id, u) }
    return u
  }
  const slots = config ? resolveSlots(config) : null
  const geminiSlots = (slots ?? []).filter(s => s.provider === "gemini" && !(envCondition && s.slot === "condition_extract"))
  for (const s of geminiSlots) use(s.model).tools.push(s.label)
  if (envCondition && !isClaudeId(envCondition)) use(envCondition).condition = true
  const fallback = (config?.get(FALLBACK_SLOT) ?? "").trim()
  if (fallback && !isClaudeId(fallback)) use(fallback).fallback = true
  for (const q of queue ?? []) {
    for (const m of new Set([q.model, q.fallbackModel])) if (m && !isClaudeId(m)) use(m).sales.push(q.code)
  }

  // A model can be served without appearing in the list (image and speech models sit
  // oddly in it), so each missing one is asked for by name before it is called gone.
  // ⚠ Only Google saying "no such model" (404, or 400 for a name it can't read) makes it
  // GONE. A 429, 5xx or timeout on the lookup is Google not answering — calling that gone
  // would raise a false alarm naming tools that work. Those, and any lookup skipped for
  // time, are UNCONFIRMED, which can never be green.
  const notListed = [...uses.keys()].filter(id => !catalogue.names.has(bareModel(id)))
  const gone = new Set<string>()
  const unconfirmed = new Set<string>()
  let lookups = 0
  for (const id of notListed) {
    if (lookups >= MAX_CONFIRM || Date.now() > deadline - 2_000) { unconfirmed.add(id); continue }
    lookups++
    const r = await googleGet(`${API}/models/${encodeURIComponent(bareModel(id))}`, key, deadline)
    if (r.ok) continue
    if (r.status === 404 || r.status === 400) gone.add(id)
    else unconfirmed.add(id)
  }
  const whoUses = (id: string): string[] => {
    const u = uses.get(id)
    if (!u) return []
    return [
      ...u.tools,
      ...(u.fallback ? ["the fallback model"] : []),
      ...(u.condition ? ["condition report emails"] : []),
      ...u.sales.map(c => `overnight sale ${c}`),
    ]
  }

  const problems: { state: "down" | "degraded"; summary: string }[] = []
  const facts: Fact[] = [{ label: "Key", value: "Accepted by Google", tone: "good" }]
  if (!catalogue.complete) {
    facts.push({ label: "Google's model list", value: "Only partly read in time — models missing from it were asked about one by one instead.", tone: "warn" })
  }

  if (slots) {
    const broken = geminiSlots.filter(s => gone.has(s.model))
    if (broken.length && broken.length === geminiSlots.length) {
      problems.push({ state: "down", summary: "Google doesn't offer any of the AI models the Hub is set to use, so every AI button fails." })
    } else if (broken.length) {
      problems.push({
        state: "degraded",
        summary: `${broken.length} AI ${plural(broken.length, "tool is", "tools are")} set to a model Google doesn't offer, so ${plural(broken.length, "it fails", "they fail")}: ${listNames(broken.map(b => b.label))}.`,
      })
    }
  } else {
    facts.push({ label: "AI Models settings", value: "Couldn't be read from the database, so the models the tools use couldn't be checked.", tone: "warn" })
  }
  if (uses.size) {
    const offered = uses.size - gone.size - unconfirmed.size
    facts.push({
      label: "Models in use",
      value: `${offered} of ${uses.size} offered by Google${unconfirmed.size ? ` · ${unconfirmed.size} couldn't be confirmed` : ""}`,
      tone: gone.size ? "bad" : unconfirmed.size ? "warn" : "good",
    })
  }
  for (const id of [...gone].slice(0, 8)) {
    facts.push({ label: id, value: `Not offered by Google — used by ${listNames(whoUses(id), 4)}`, tone: "bad" })
  }
  for (const id of [...unconfirmed].slice(0, 8)) {
    facts.push({ label: id, value: `Couldn't be confirmed — Google didn't answer when asked about it. Used by ${listNames(whoUses(id), 4)}`, tone: "warn" })
  }

  // ── The fallback model ──
  if (config) {
    if (!fallback) {
      facts.push({ label: "Fallback model", value: "None set, so a refused request isn't tried on a second model." })
    } else if (isClaudeId(fallback)) {
      facts.push({ label: "Fallback model", value: `${fallback} — a Claude model, which Admin → AI Models never offers here; worth checking.`, tone: "warn" })
    } else if (gone.has(fallback)) {
      problems.push({ state: "degraded", summary: `The fallback model (${fallback}) isn't offered by Google, so there's no second model to try when the main one fails.` })
    } else if (unconfirmed.has(fallback)) {
      facts.push({ label: "Fallback model", value: `${fallback} — couldn't be confirmed with Google`, tone: "warn" })
    } else if (slots && await onHubRetiredList(fallback, slots, deadline)) {
      // ⚠ getFallbackModel() silently drops a retired name, so this means NO fallback at all.
      problems.push({ state: "degraded", summary: `The fallback model (${fallback}) is on the Hub's retired list, so it's ignored and there's no second model to try.` })
      facts.push({ label: "Fallback model", value: `${fallback} — on the Hub's retired list, so it's ignored`, tone: "bad" })
    } else {
      facts.push({ label: "Fallback model", value: `${fallback} — offered by Google`, tone: "good" })
    }
  }

  if (envCondition && gone.has(envCondition)) {
    problems.push({ state: "degraded", summary: `The model set on the server for reading condition report emails (${envCondition}) isn't offered by Google.` })
  }

  // ── Sales waiting for the overnight run ──
  if (!ctx.backgroundJobsExpected) {
    facts.push({ label: "Overnight queue", value: "Not checked — the overnight run doesn't run on this environment." })
  } else if (!queue) {
    facts.push({ label: "Overnight queue", value: "Couldn't be read from the database.", tone: "warn" })
  } else {
    const hit = [...new Set(queue.filter(q => gone.has(q.model) || gone.has(q.fallbackModel)).map(q => q.code))]
    if (hit.length) {
      problems.push({ state: "degraded", summary: `Overnight ${plural(hit.length, "sale", "sales")} ${listNames(hit)} ${plural(hit.length, "is", "are")} queued with a model Google doesn't offer.` })
    } else {
      const unsure = [...new Set(queue.filter(q => unconfirmed.has(q.model) || unconfirmed.has(q.fallbackModel)).map(q => q.code))]
      const waiting = `${queue.length} ${plural(queue.length, "sale", "sales")} waiting`
      facts.push({
        label: "Overnight queue",
        value: !queue.length ? "Nothing queued"
          : unsure.length ? `${waiting} — the models for ${listNames(unsure)} couldn't be confirmed with Google`
          : `${waiting} — the models they're set to are offered by Google`,
        tone: !queue.length ? undefined : unsure.length ? "warn" : "good",
      })
    }
  }

  // Switched off in Auction AI → Models only hides a model from the pickers; the tools
  // still use it (loadConfig never reads DisabledModel). Worth knowing, not a fault.
  if (disabled) {
    const offButUsed = [...uses.keys()].filter(id => disabled.has(id) && !gone.has(id))
    if (offButUsed.length) {
      facts.push({ label: "Switched off but still used", value: `${listNames(offButUsed, 4)} — switched off in Auction AI → Models, yet still set for a tool.`, tone: "warn" })
    }
  }

  // ── What Google did with real requests ──
  if (tally.refused >= REFUSALS_FOR_AMBER) {
    problems.push({ state: "degraded", summary: `Google refused ${tally.refused} AI requests in the last 30 minutes for going over the allowance.` })
  }
  if (tally.failed >= FAILURES_FOR_AMBER) {
    problems.push({ state: "degraded", summary: `${tally.failed} AI requests to Google failed in the last 30 minutes — ${failureReason(tally.failedKinds, "Google")}.` })
  }
  facts.push(...passiveFacts)
  facts.push({
    label: "Counted from",
    value: "Only tools that use the Hub's shared AI code. Several talk to Google directly and aren't counted yet — the batch run, key-point and double checks, AI Upgrade and the overnight pipeline among them.",
  })
  facts.push({
    label: "Not checked",
    value: "A model someone picked on their own device (saved in the browser), and Google actually writing an answer — the check never asks for one, as every request uses up the allowance.",
  })

  const headline = problems.find(p => p.state === "down") ?? problems[0]
  if (headline) {
    const also: Fact[] = problems.filter(p => p !== headline).map(p => ({ label: "Also", value: p.summary, tone: p.state === "down" ? "bad" : "warn" }))
    return { state: headline.state, summary: headline.summary, facts: [...also, ...facts], latencyMs }
  }
  if (!config) {
    return { state: "unknown", summary: "Google accepted the key, but the Hub couldn't read its AI Models settings, so the models couldn't be checked.", facts, latencyMs }
  }
  if (unconfirmed.size) {
    const n = unconfirmed.size
    return {
      state: "unknown",
      summary: `Google accepted the key, but ${n} of the ${uses.size} AI models the Hub uses couldn't be confirmed, so this couldn't be fully checked.`,
      facts,
      latencyMs,
    }
  }
  return {
    state: "ok",
    summary: uses.size === 1
      ? "Google accepted the key and the AI model the Hub uses is available."
      : `Google accepted the key and all ${uses.size} AI models the Hub uses are available.`,
    facts,
    latencyMs,
  }
}

const gemini: StatusCheckDef = {
  key: "gemini",
  name: "Gemini AI",
  group: "ai",
  what: "Writes descriptions and estimates, runs the key-point and double checks, Lens, AI Upgrade and most AI tools.",
  whenDown: "AI buttons fail and the overnight run stalls.",
  statusPage: "https://aistudio.google.com/status",
  intervalMin: 10,
  run,
}

export default gemini
