import { prisma } from "@/lib/prisma"
import type { CheckResult, Fact, StatusCheckDef } from "../types"

// 🚦 Royal Mail Click & Drop — can Packing print a label right now?
//
// ⚠⚠ READ-ONLY. Labels cost money. The only calls made here are GETs that read an order back.
// NEVER call POST /orders (creates an order), GET /orders/{id}/label (can generate the label and
// buy the postage), POST /manifests (manifests every open label — irreversible), PUT /orders/status,
// DELETE /orders or GET /services.
//
// ⚠ Neither GET used here is called anywhere else in the Hub — lib/royal-mail.ts only proves the
// base address and the Bearer header. So a 404, or an answer in a shape we don't recognise, is
// "unknown" (grey: the check itself needs looking at), never red: it may be our request that is
// wrong, not Royal Mail (research reviewer, 2026-09-10).
//
// ⚠ Green means "Royal Mail accepted our key and answered". It does NOT promise every label prints:
// a label can still be refused for its own reasons (the service code, the package format — see the
// RM_SERVICE_FORMATS note in lib/royal-mail.ts), and only a real label proves that.

const RM_BASE = "https://api.parcel.royalmail.com/api/v1" // same address as lib/royal-mail.ts (not exported there)
// Two calls at most (an order, then the list if that order has gone), and both must fit inside the
// engine's 25-second cap with room to spare: 3 s for our own reads + 10 s + 10 s = 23 s.
const TIMEOUT_MS = 10_000
/** ⚠ The Hub's own parcel reads come first, and a wedged database must not eat the time Royal Mail's
 *  answer needs (the engine would then abandon the check as "unknown" and hide what Royal Mail said).
 *  Past this they're skipped and Royal Mail is asked anyway. */
const DB_DEADLINE_MS = 3_000

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error("timed out")), ms) })
  return Promise.race([p, late]).finally(() => clearTimeout(t))
}

type Probe =
  | { kind: "answer"; status: number; body: unknown; parsed: boolean; ms: number }
  | { kind: "failed"; reason: "timeout" | "dns" | "network"; ms: number }

function netFailure(e: unknown): "timeout" | "dns" | "network" {
  const err = e as { name?: string; code?: string; cause?: { name?: string; code?: string } } | null
  if (err?.name === "TimeoutError" || err?.name === "AbortError" || err?.cause?.name === "TimeoutError") return "timeout"
  const code = err?.cause?.code ?? err?.code
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns"
  return "network"
}

async function rmGet(path: string, key: string): Promise<Probe> {
  const t0 = Date.now()
  try {
    const res = await fetch(`${RM_BASE}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    })
    const text = await res.text().catch(() => "")
    let body: unknown = null
    let parsed = false
    try { body = JSON.parse(text); parsed = true } catch { /* not JSON — judged below */ }
    return { kind: "answer", status: res.status, body, parsed, ms: Date.now() - t0 }
  } catch (e) {
    return { kind: "failed", reason: netFailure(e), ms: Date.now() - t0 }
  }
}

/** GET /orders/{id} answers with an array of orders; GET /orders with { orders: [...] }. Accept either. */
function looksLikeOrders(body: unknown): boolean {
  if (Array.isArray(body)) return true
  const b = body as { orders?: unknown; orderIdentifier?: unknown } | null
  return !!b && typeof b === "object" && (Array.isArray(b.orders) || b.orderIdentifier != null)
}

function fmtWhen(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(d)
}

const check: StatusCheckDef = {
  key: "royal-mail",
  name: "Royal Mail Click & Drop",
  group: "suppliers",
  what: "Postage labels, tracking numbers and the end-of-day manifest in Packing.",
  whenDown: "Labels can't be printed from the Hub.",
  intervalMin: 30,

  async run(ctx): Promise<CheckResult> {
    const key = process.env.ROYAL_MAIL_API_KEY
    if (!key) {
      return { state: "off", summary: "Not set up here: there's no Royal Mail key on this environment, so labels can't be printed from it." }
    }

    // What Packing has actually done — the cheapest honest signal, and the order to read back.
    // ⚠ Only ever the identifier and dates: never labelPdf (a whole PDF per row) or an address.
    let lastOrder: { rmOrderIdentifier: string | null; updatedAt: Date } | null = null
    let lastManifest: Date | null = null
    let parcelsRead = false
    try {
      const [o, m] = await withDeadline(Promise.all([
        prisma.parcel.findFirst({
          where: { rmOrderIdentifier: { not: null } },
          orderBy: { updatedAt: "desc" },
          select: { rmOrderIdentifier: true, updatedAt: true },
        }),
        prisma.parcel.aggregate({ _max: { despatchedAt: true } }),
      ]), DB_DEADLINE_MS)
      lastOrder = o
      lastManifest = m._max.despatchedAt
      parcelsRead = true
    } catch { /* the database has its own light — Royal Mail can still be asked */ }

    const passive: Fact[] = []
    // ⚠ Production only: staging and sandbox hold production's parcels as they were the day the
    // copy was made, so their "last label" would be an old date that means nothing there.
    // ⚠ A read that failed must never show as "None yet" — that reads as a quiet day in Packing.
    if (ctx.isProduction) {
      if (!parcelsRead) {
        passive.push({ label: "Packing's own records", value: "Couldn't read them just now, so the last parcel and manifest aren't shown", tone: "warn" })
      } else {
        // updatedAt, not a label time (none is stored) — the manifest moves it too, hence "activity".
        passive.push({ label: "Last Royal Mail parcel activity", value: lastOrder ? fmtWhen(lastOrder.updatedAt) : "None yet" })
        passive.push({ label: "Last end-of-day manifest", value: lastManifest ? fmtWhen(lastManifest) : "None yet" })
      }
    }
    passive.push({ label: "What green means", value: "Royal Mail accepted the Hub's key and answered. Only a real label proves a particular service will print." })

    // ⚠ Digits only: the identifier goes into a URL path, and anything else could point the GET
    // somewhere it was never meant to go. Click & Drop order identifiers are whole numbers.
    const id = lastOrder?.rmOrderIdentifier && /^\d{1,20}$/.test(lastOrder.rmOrderIdentifier) ? lastOrder.rmOrderIdentifier : null
    let how: string
    let p: Probe
    if (id) {
      p = await rmGet(`/orders/${encodeURIComponent(id)}`, key)
      how = "Read back the most recent order the Hub made — nothing is bought or printed."
      // A 404 on one order usually just means it was removed in Click & Drop — the key got past the
      // door. Ask for the list once instead before deciding anything (one fallback, no retry loop).
      if (p.kind === "answer" && p.status === 404) {
        p = await rmGet("/orders?pageSize=1", key)
        how = "Listed one order (the Hub's most recent one is no longer in Click & Drop) — nothing is bought or printed."
      }
    } else {
      p = await rmGet("/orders?pageSize=1", key)
      how = "Listed one order — nothing is bought or printed."
    }
    const facts: Fact[] = [{ label: "How it was checked", value: how }]

    if (p.kind === "failed") {
      const summary =
        p.reason === "timeout" ? `Royal Mail didn't answer within ${TIMEOUT_MS / 1000} seconds, so labels can't be printed right now.`
        : p.reason === "dns"   ? "Couldn't find Royal Mail's system at all (its address didn't look up), so labels can't be printed."
        :                        "Couldn't connect to Royal Mail, so labels can't be printed right now."
      return { state: "down", summary, facts: [...facts, { label: "Royal Mail", value: "Not answering", tone: "bad" }, ...passive] }
    }

    const { status, ms } = p
    if (status >= 200 && status < 300 && p.parsed && looksLikeOrders(p.body)) {
      return {
        state: "ok",
        summary: "Royal Mail accepted the Hub's key and is answering.",
        facts: [...facts, { label: "Key", value: "Accepted", tone: "good" }, ...passive],
        latencyMs: ms,
      }
    }
    if (status === 401 || status === 403) {
      // ⚠ cause "hub": Royal Mail answered, so it is up — it's OUR key it turned away, and replacing
      // ROYAL_MAIL_API_KEY is ours to do. Every other bad answer below is Royal Mail's own side.
      return {
        state: "down",
        cause: "hub",
        summary: "Royal Mail refused the Hub's key, so labels can't be printed.",
        facts: [...facts, { label: "Key", value: `Refused (${status}) — it may have been changed or revoked in Click & Drop`, tone: "bad" }, ...passive],
        latencyMs: ms,
      }
    }
    if (status === 429) {
      return {
        state: "degraded",
        summary: "Royal Mail is limiting how often the Hub can ask, so labels may be refused for a few minutes.",
        facts: [...facts, { label: "Royal Mail", value: "Rate limited (429)", tone: "warn" }, ...passive],
        latencyMs: ms,
      }
    }
    if (status >= 500) {
      return {
        state: "down",
        summary: `Royal Mail's system is answering with an error (${status}), so labels can't be printed right now.`,
        facts: [...facts, { label: "Royal Mail", value: `Error ${status}`, tone: "bad" }, ...passive],
        latencyMs: ms,
      }
    }
    // 404 after the fallback, another 4xx, or a 2xx in a shape we don't know: the endpoint is
    // unproven in this codebase, so this is a question for us, not a Royal Mail outage.
    return {
      state: "unknown",
      summary: "Couldn't confirm — this check needs looking at.",
      facts: [...facts, { label: "Royal Mail answered", value: `HTTP ${status}${p.parsed ? "" : " (not JSON)"} — not what the check expected`, tone: "warn" }, ...passive],
      latencyMs: ms,
    }
  },
}

export default check
