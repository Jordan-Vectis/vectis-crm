import Anthropic from "@anthropic-ai/sdk"
import { CLAUDE_MODELS } from "@/lib/ai-models"
import type { CheckContext, CheckResult, Fact, StatusCheckDef } from "../types"
import {
  FAILURES_FOR_AMBER, REFUSALS_FOR_AMBER, failureCause, failureReason, isClaudeId, lastAnswerFact, listNames, plural,
  readToolModels, resolveSlots, tallyAi, tallyFact, type SlotModel,
} from "./gemini"

// 🚦 Claude AI — the optional second AI provider (lib/ai-provider.ts). It is used by
// any tool an admin has switched to a Claude model in Admin → AI Models, and — once
// a key exists — by anyone who picks a Claude model in a tool's own model picker.
//
// ⚠ With no key it is NOT a fault: the Hub is built for environments without one
// (usable() in lib/ai-models.ts quietly sends a Claude-set tool to its Gemini
// default). The one thing worth raising then is an admin having CHOSEN Claude for a
// tool that is silently running on Gemini instead.
//
// With a key: models.retrieve for every Claude model the Hub offers. That proves the
// key is accepted and each model id exists. ⚠⚠ NEVER messages.create — it costs
// money. The price of that rule: a key on an account with no credit still passes
// the models lookup, so the passive signal (a real Claude request refused for
// credit, recorded in lib/ai-provider.ts) is the only way the light can see it.

const REQUEST_TIMEOUT_MS = 10_000
/** All the lookups must be finished by then — the engine abandons a check at 25 s. */
const BUDGET_MS = 20_000

const WHY_NOT_CLAUDE: Record<NonNullable<SlotModel["claudeSkipped"]>, string> = {
  "no-key": "there's no Claude key on this environment",
  "slot-cannot": "this tool can't use Claude yet",
  "unknown-model": "the Hub doesn't know that Claude model",
}

/** `cause` as on CheckResult: "hub" when Anthropic is up and answering and the fix is ours. */
type Verdict = { state: "down" | "degraded" | "unknown"; summary: string; reason: string | null; cause?: "hub" }

/** What a failed models lookup means. */
function classify(e: unknown): Verdict {
  const reason = e instanceof Anthropic.APIError && typeof e.type === "string" ? e.type : null
  if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError) {
    return { state: "down", summary: `Anthropic didn't answer within ${REQUEST_TIMEOUT_MS / 1000} seconds, so anything set to Claude is likely to fail.`, reason }
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return { state: "down", summary: "The Hub couldn't reach Anthropic at all, so anything set to Claude fails.", reason }
  }
  if (e instanceof Anthropic.APIError) {
    const s = e.status
    // cause "hub": Anthropic answered, so it is up — it's OUR key it turned away.
    if (s === 401) return { state: "down", summary: "Anthropic refused the Claude key, so anything set to Claude fails.", reason, cause: "hub" }
    if (s === 403) return { state: "down", summary: "Anthropic refused the Claude key access to the models, so anything set to Claude fails.", reason, cause: "hub" }
    if (s === 429) return { state: "degraded", summary: "Anthropic is rate-limiting the Hub right now — even the free model lookup was refused.", reason }
    // cause "hub": Anthropic is working — it's our account that needs topping up.
    if (e.type === "billing_error" || /credit balance/i.test(String(e.message))) {
      return { state: "down", summary: "Anthropic says the account has run out of credit, so anything set to Claude fails.", reason, cause: "hub" }
    }
    if (s === 529) return { state: "down", summary: "Anthropic is overloaded right now, so anything set to Claude is likely to fail.", reason }
    if (typeof s === "number" && s >= 500) return { state: "down", summary: `Anthropic's service is failing — it answered the Hub with error ${s}.`, reason }
    if (typeof s === "number") return { state: "unknown", summary: `Anthropic turned down the check's own request (error ${s}), so this couldn't be confirmed.`, reason }
  }
  return { state: "unknown", summary: "The check couldn't complete, so this couldn't be confirmed.", reason: null }
}

type Lookup = {
  found: string[]
  missing: string[]
  /** Skipped because the time budget ran out — never counted as available. */
  unchecked: string[]
  outcome: Map<string, string>
  stop: Verdict | null
  latencyMs?: number
}

/**
 * models.retrieve for each id, one at a time, no retries; the first refusal stops the rest —
 * a key that's been refused once will be refused three times.
 * ⚠ Never rejects (everything is caught): it is started BEFORE the settings read is awaited,
 * and a rejection nobody is listening to yet would crash the whole server.
 */
async function lookUpModels(key: string, ids: string[]): Promise<Lookup> {
  const r: Lookup = { found: [], missing: [], unchecked: [], outcome: new Map(), stop: null }
  const deadline = Date.now() + BUDGET_MS
  try {
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS })
    for (const id of ids) {
      if (r.stop) { r.outcome.set(id, "Not checked — stopped at the first error"); continue }
      const left = deadline - Date.now()
      if (left < 2_000) { r.unchecked.push(id); r.outcome.set(id, "Not checked — ran out of time"); continue }
      const ms = Math.min(REQUEST_TIMEOUT_MS, left)
      const t0 = Date.now()
      try {
        await client.models.retrieve(id, null, { signal: AbortSignal.timeout(ms), timeout: ms, maxRetries: 0 })
        r.found.push(id)
        r.outcome.set(id, "Available")
      } catch (e) {
        if (e instanceof Anthropic.NotFoundError) {
          r.missing.push(id)
          r.outcome.set(id, "Anthropic says this model doesn't exist")
        } else {
          r.stop = classify(e)
          r.outcome.set(id, "Couldn't check")
        }
      } finally {
        r.latencyMs ??= Date.now() - t0
      }
    }
  } catch (e) {
    r.stop ??= classify(e)
  }
  return r
}

async function run(ctx: CheckContext): Promise<CheckResult> {
  const nowMs = ctx.now.getTime()
  const key = process.env.ANTHROPIC_API_KEY
  const ids = CLAUDE_MODELS.map(m => m.id)
  // ⚠ Both started at once: the settings read can take up to 8 s on a sick database
  // (2026-09-09), and 8 s plus three 10-second lookups would overrun the engine's cap
  // and lose Anthropic's answer along with it.
  const lookups = key ? lookUpModels(key, ids) : null
  const config = await readToolModels()
  const slots = config ? resolveSlots(config) : null
  const setToClaude = (slots ?? []).filter(s => isClaudeId(s.configured))
  const onClaude = setToClaude.filter(s => s.provider === "anthropic")
  // Chose Claude, but usable() is quietly running the tool on its Gemini default.
  const sidelined = setToClaude.filter(s => s.provider !== "anthropic")
  const sidelinedFacts: Fact[] = sidelined.map(s => ({
    label: s.label,
    value: `Set to ${s.configured}, running on ${s.model} — ${WHY_NOT_CLAUDE[s.claudeSkipped ?? "no-key"]}`,
    tone: "warn",
  }))

  // ── No key ──
  if (!key || !lookups) {
    if (!slots) {
      return {
        state: "off",
        summary: "Not set up — there's no Claude key on this environment.",
        facts: [{ label: "AI Models settings", value: "Couldn't be read, so it's not known whether any tool is set to Claude.", tone: "warn" }],
      }
    }
    if (sidelined.length) {
      const n = sidelined.length
      // cause "hub": Anthropic isn't even being asked — the key is missing from OUR server, or the
      // AI Models setting should be changed back. Either way the fix is ours.
      return {
        state: "degraded",
        summary: `${n} ${plural(n, "tool is", "tools are")} set to Claude, but there's no Claude key here, so ${plural(n, "it's", "they're")} quietly running on Gemini instead.`,
        facts: sidelinedFacts,
        cause: "hub",
      }
    }
    return { state: "off", summary: "Not set up — there's no Claude key on this environment, and no tool is set to Claude." }
  }

  // ── With a key: look up every Claude model the Hub offers ──
  // ⚠ Every one, not just those set in Admin → AI Models: with a key, the model pickers
  //   offer them all, and the AI routes honour a model the browser sends.
  // ⚠ models.retrieve, never a name match against models.list: the list gives full dated
  //   ids while the Hub uses alias ids ("claude-haiku-4-5"), which retrieve resolves.
  const { found, missing, unchecked, outcome, stop, latencyMs } = await lookups
  const modelFacts: Fact[] = ids.map(id => ({
    label: id,
    value: outcome.get(id) ?? "Not checked",
    tone: found.includes(id) ? "good" : missing.includes(id) ? "bad" : undefined,
  }))

  const tally = tallyAi("anthropic", nowMs)
  const common: Fact[] = [
    slots
      ? { label: "Tools set to Claude", value: onClaude.length ? listNames(onClaude.map(s => s.label), 6) : "None — Claude is only offered in the model pickers" }
      : { label: "AI Models settings", value: "Couldn't be read, so it's not known which tools are set to Claude.", tone: "warn" },
    ...sidelinedFacts,
    tallyFact(tally, "refused by the rate limit"),
    lastAnswerFact(tally, "Claude", nowMs),
    {
      label: "Not checked",
      value: "Whether the account has credit — only a real request shows that, and the check never makes one because it costs money. A refused request shows here when it happens.",
    },
  ]

  if (stop) {
    const reasonFact: Fact[] = stop.reason ? [{ label: "Anthropic's reason", value: stop.reason, tone: "bad" }] : []
    return { state: stop.state, summary: stop.summary, facts: [...reasonFact, ...modelFacts, ...common], latencyMs, cause: stop.cause }
  }

  // cause "hub" on the model problems below: Anthropic is up and answering — it's the Hub that is
  // set to, or still offers, a model Anthropic no longer has, or that has chosen Claude for a tool
  // that can't use it. Only what Anthropic did with real requests can be Anthropic's.
  const problems: { state: "down" | "degraded"; summary: string; cause?: "hub" }[] = []
  const inUse = new Set(onClaude.map(s => s.model))
  const goneInUse = missing.filter(id => inUse.has(id))
  const goneOffered = missing.filter(id => !inUse.has(id))
  if (goneInUse.length) {
    const hit = onClaude.filter(s => goneInUse.includes(s.model))
    problems.push({
      state: hit.length === onClaude.length ? "down" : "degraded",
      summary: `Anthropic says ${listNames(goneInUse)} ${plural(goneInUse.length, "doesn't", "don't")} exist, so ${hit.length} ${plural(hit.length, "tool set to it fails", "tools set to them fail")}.`,
      cause: "hub",
    })
  }
  if (goneOffered.length) {
    problems.push({
      state: "degraded",
      summary: `Anthropic says ${listNames(goneOffered)} ${plural(goneOffered.length, "doesn't", "don't")} exist, but the model pickers still offer ${plural(goneOffered.length, "it", "them")}.`,
      cause: "hub",
    })
  }
  if (sidelined.length) {
    const n = sidelined.length
    problems.push({ state: "degraded", summary: `${n} ${plural(n, "tool is", "tools are")} set to Claude but ${plural(n, "is", "are")} running on Gemini instead.`, cause: "hub" })
  }

  // ── What Anthropic did with real requests ──
  const outOfCredit = tally.latest?.kind === "credit"
  if (outOfCredit) {
    // cause "hub": Anthropic is working — it's our account that needs topping up.
    problems.push({ state: "down", summary: "Anthropic accepted the key but refused the last Claude request because the account is out of credit, so tools set to Claude fail.", cause: "hub" })
  }
  if (tally.refused >= REFUSALS_FOR_AMBER) {
    problems.push({ state: "degraded", summary: `Anthropic refused ${tally.refused} Claude requests in the last 30 minutes for going over the rate limit.` })
  }
  if (tally.failed >= FAILURES_FOR_AMBER && !outOfCredit) {
    problems.push({ state: "degraded", summary: `${tally.failed} Claude requests failed in the last 30 minutes — ${failureReason(tally.failedKinds, "Anthropic")}.`, cause: failureCause(tally.failedKinds) })
  }

  const facts: Fact[] = [{ label: "Key", value: "Accepted by Anthropic", tone: "good" }, ...modelFacts, ...common]
  const headline = problems.find(p => p.state === "down") ?? problems[0]
  if (headline) {
    const also: Fact[] = problems.filter(p => p !== headline).map(p => ({ label: "Also", value: p.summary, tone: p.state === "down" ? "bad" : "warn" }))
    // The headline's cause, never a mix: the banner names whichever problem the tile leads with.
    return { state: headline.state, summary: headline.summary, facts: [...also, ...facts], latencyMs, cause: headline.cause }
  }
  if (unchecked.length) {
    return {
      state: "unknown",
      summary: `Anthropic accepted the key, but ${unchecked.length} of the ${ids.length} Claude models couldn't be checked in time, so this couldn't be fully confirmed.`,
      facts,
      latencyMs,
    }
  }
  const n = ids.length
  return {
    state: "ok",
    summary: onClaude.length
      ? `Anthropic accepted the key and all ${n} Claude models are available; ${onClaude.length} ${plural(onClaude.length, "tool uses", "tools use")} Claude.`
      : `Anthropic accepted the key and all ${n} Claude models are available.`,
    facts,
    latencyMs,
  }
}

const claude: StatusCheckDef = {
  key: "claude",
  name: "Claude AI",
  group: "ai",
  what: "The second AI provider, used by tools an admin has switched to a Claude model.",
  whenDown: "Tools set to Claude fail.",
  statusPage: "https://status.anthropic.com",
  intervalMin: 10,
  run,
}

export default claude
