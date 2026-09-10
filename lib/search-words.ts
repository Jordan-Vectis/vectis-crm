import { prisma } from "@/lib/prisma"
import { htmlToText, HTML_IN_TEXT_SQL } from "@/lib/html-text"

// 🔎 Website Search — making the search forgiving (Jordan, 2026-09-10: "if I add a , anywhere it
// doesn't find that one lot — the search needs to be a bit smarter"; "Kämmer & Reinhardt" found
// nothing because the lot says "Kammer").
//
// Three things, all built from our own data — nothing external, no AI call per search:
//  1. TIDY WORDS — punctuation stripped, little words ("&", "and", "the") ignored, capitals never
//     matter. Accents don't matter either way: the typed word is searched as typed AND folded
//     (Kämmer → kammer), and the spelling list knows the accented spellings our descriptions use
//     (marklin → märklin).
//  2. PLURALS — "buses" also finds "bus", "lorry" also finds "lorries".
//  3. TYPOS — a spelling list of every word in our 1.2 million descriptions, with how often it
//     appears, so "Reinhart", "Stieff" or "Merrythougt" also search the real word. Candidates come
//     from a trigram index (pg_trgm) and are confirmed by edit distance here, which catches swapped
//     letters (Stieff/Steiff) that trigrams alone score badly. Only unknown or rare words are
//     corrected, and the page says what it also searched for, so it's never a mystery.
//
// ⚠⚠ NEVER fold or rewrite the DESCRIPTIONS at search time. Measured on production 2026-09-10:
// translate() over ArchiveLot took 36 s for "halo" against 3.3 s for a plain ILIKE, and every search
// timed out. The search stays a plain ILIKE on the stored text; the cleverness goes on the typed
// words and into the spelling list, which is small and indexed.

// Folds accents on the typed words (and, in the build, on the spelling list's keys).
// (1-to-1, so "ß" → "ss" can't be done; it's rare in our descriptions.)
export const FOLD_FROM = "ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÇçÑñÝýÿ"
export const FOLD_TO   = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuCcNnYyy"

/** Accents folded with the same map the spelling list uses, then lower-cased. */
export function foldText(s: string): string {
  let out = ""
  for (const ch of s) {
    const i = FOLD_FROM.indexOf(ch)
    out += i >= 0 ? FOLD_TO[i] : ch
  }
  return out.toLowerCase()
}

const STOP_WORDS = new Set(["and", "the", "of", "with", "a", "an", "in", "to", "for", "by", "on", "at", "or"])
const SPLIT = /[\s,;:!?()[\]{}<>"“”‘’'&+|*#~`=_\\]+/

/** One typed word: `word` is folded and lower case (what the spelling list is keyed on); `raw` is
 *  lower case with its accents kept, so "Kämmer" still finds "Kämmer" before the list exists. */
export type Token = { word: string; raw: string }

/** The words to search for: punctuation stripped, little words dropped (unless they're all there
 *  is). Hyphens, dots and slashes INSIDE a word are kept — codes like R009030-1, No.102 and 1/43
 *  need them. */
export function tokens(q: string, max = 8): Token[] {
  const all = q.toLowerCase().split(SPLIT)
    .map(p => p.replace(/^[-./]+|[-./]+$/g, ""))
    .map(raw => ({ raw, word: foldText(raw) }))
    .filter(t => t.word.length >= 2)
  const kept = all.filter(t => !STOP_WORDS.has(t.word))
  const seen = new Set<string>()
  return (kept.length ? kept : all).filter(t => !seen.has(t.word) && !!seen.add(t.word)).slice(0, max)
}

// Words that end in s but aren't plurals — never trimmed.
const NOT_PLURAL = new Set(["series", "species", "news", "lens", "chassis", "bus", "gas", "yes", "plus", "atlas", "canvas", "class", "glass", "brass", "cross", "dress", "express", "mercedes", "hercules", "thomas", "douglas", "james"])

/** Spellings that should also count for a word. A shorter stem is enough when it's contained in both
 *  forms ("train" matches train and trains); otherwise both forms are listed. */
export function pluralVariants(w: string): string[] {
  if (w.length < 4 || /[^a-z]/.test(w) || NOT_PLURAL.has(w)) return [w]
  if (w.endsWith("ies") && w.length > 4) return [w, w.slice(0, -3) + "y"]            // lorries → lorry
  if (/(xes|zes|ches|shes|sses)$/.test(w)) return [w.slice(0, -2)]                    // boxes → box, coaches → coach
  if (w.endsWith("uses")) return [w.slice(0, -2)]                                     // buses → bus, omnibuses → omnibus
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) return [w.slice(0, -1)]              // trains → train, cases → case
  if (/[^aeiou]y$/.test(w)) return [w, w.slice(0, -1) + "ies"]                         // lorry → lorries
  return [w]
}

// ── The spelling list ──────────────────────────────────────────────────────────

export type SpellingState = "ready" | "building" | "unavailable"

// Bump when what the build stores changes — the next search then rebuilds the list.
// 2 = the accented spellings per word ("forms"), 2026-09-10.
const BUILD_VERSION = 2

type Snapshot = { state: SpellingState; builtAt: number | null; version: number; buildingSince: number | null; at: number }
type Mem = { building: boolean; lastAttempt: number; cache: Snapshot | null }
function mem(): Mem {
  const g = globalThis as unknown as { _searchWords?: Mem }
  return (g._searchWords ??= { building: false, lastAttempt: 0, cache: null })
}

const REBUILD_AFTER_MS = 7 * 86_400_000
const RETRY_AFTER_MS = 60 * 60_000
// A build touches "buildingSince" after every batch. Older than this, whoever was building has gone
// (a deploy restarts the Hub mid-build), so the next search may start again.
const HEARTBEAT_STALE_MS = 3 * 60_000

/** Is the spelling list there to use? Cached for a minute — it's asked on every search. */
export async function spellingState(): Promise<Snapshot> {
  const m = mem()
  const now = Date.now()
  if (!m.cache || now - m.cache.at >= 60_000) {
    try {
      const rows = await prisma.$queryRaw<{ builtAt: Date | null; words: number; buildingSince: Date | null; version: number }[]>`
        SELECT "builtAt", "words", "buildingSince", "version" FROM "SearchWordState" WHERE "id" = 'current'`
      const r = rows[0]
      const since = r?.buildingSince?.getTime() ?? null
      const busy = since != null && now - since < HEARTBEAT_STALE_MS
      // An old list is still perfectly usable while a new one is being built.
      const state: SpellingState = r?.builtAt && Number(r.words) > 0 ? "ready" : busy ? "building" : "unavailable"
      m.cache = { state, builtAt: r?.builtAt?.getTime() ?? null, version: Number(r?.version ?? 0), buildingSince: since, at: now }
    } catch {
      // Before Run Migrations the tables aren't there — the search simply works without spelling help.
      m.cache = { state: "unavailable", builtAt: null, version: 0, buildingSince: null, at: now }
    }
  }
  const c = m.cache
  return c.state !== "ready" && m.building ? { ...c, state: "building" } : c
}

/** London evening or night — when a rebuild won't slow anyone down. */
function quietHour(): boolean {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date())) % 24
  return h >= 19 || h < 7
}

/** Builds the list the first time it's needed (or when BUILD_VERSION changes), and refreshes it
 *  weekly (evenings only). Never waits: the search that set it off carries on without spelling help.
 *  ⚠ In-process, like the other Hub jobs — a deploy mid-build just means a later search starts again. */
export function kickWordListBuild(): void {
  void (async () => {
    const m = mem()
    if (m.building || Date.now() - m.lastAttempt < RETRY_AFTER_MS) return
    const s = await spellingState()
    if (s.buildingSince != null && Date.now() - s.buildingSince < HEARTBEAT_STALE_MS) return // already going
    const age = s.builtAt ? Date.now() - s.builtAt : Infinity
    const needed = !s.builtAt || s.version < BUILD_VERSION || (age > REBUILD_AFTER_MS && quietHour())
    if (!needed) return
    try {
      const t = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('"SearchWordBuild"') IS NOT NULL AS ok`
      // Not migrated yet — look again in a minute rather than on every search.
      if (!t[0]?.ok) { m.lastAttempt = Date.now() - RETRY_AFTER_MS + 60_000; return }
    } catch { return }
    m.lastAttempt = Date.now()
    await buildWordList()
  })().catch(() => { /* never let a background build take anything down */ })
}

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

// Letters, including accented ones — measured on production (C.UTF-8): lower() and ILIKE both handle
// accents, and this range splits "Märklin, Kämmer-Reinhardt" into Märklin / Kämmer / Reinhardt.
const WORD_SPLIT = "[^A-Za-zÀ-ÖØ-öø-ÿ]+"
// BC's short descriptions are skipped: the website's full ones (BcLotWeb) already contain them.
const SOURCES = [
  { table: "ArchiveLot", key: "id", where: "" },
  { table: "BcLotWeb", key: "uniqueId", where: `AND "description" IS NOT NULL` },
  { table: "CatalogueLot", key: "id", where: `AND "description" <> ''` },
] as const
// ~0.5–0.7 s a batch on production (measured 2026-09-10), so ~240 short queries, 2–3 minutes in all.
const BATCH = 5000

/** Step 1 of every build: turn any description still holding the website's HTML into plain text
 *  (BcLotWeb nearly all of it; a few ABC rows). Only rows that still carry tags or entities are
 *  touched, 500 at a time in key order, so it's cheap once done and safe to repeat. New lots arrive
 *  clean already — lib/archive-site.ts runs htmlToText before it stores them. */
async function cleanStoredHtml(beat: () => Promise<unknown>): Promise<number> {
  let cleaned = 0
  for (const t of [{ table: "BcLotWeb", key: "uniqueId" }, { table: "ArchiveLot", key: "id" }] as const) {
    let after = ""
    for (;;) {
      const rows = await prisma.$queryRawUnsafe<{ k: string; d: string | null }[]>(
        `SELECT "${t.key}" AS k, "description" AS d FROM "${t.table}"
         WHERE "${t.key}" > $1 AND "description" ~ ${HTML_IN_TEXT_SQL}
         ORDER BY "${t.key}" LIMIT 500`, after)
      if (!rows.length) break
      const keys = rows.map(r => r.k)
      const texts = rows.map(r => htmlToText(r.d))
      // Raw UPDATE, not prisma.update: that reads every row back afterwards (RULES.md).
      await prisma.$executeRawUnsafe(
        `UPDATE "${t.table}" SET "description" = v.d
         FROM (SELECT unnest($1::text[]) AS k, unnest($2::text[]) AS d) v
         WHERE "${t.table}"."${t.key}" = v.k`, keys, texts)
      cleaned += rows.length
      after = keys[keys.length - 1]
      if (cleaned % 20_000 < 500) console.log(`[website-search] cleaned ${cleaned.toLocaleString("en-GB")} descriptions of HTML so far`)
      await beat()
      await pause(50)
    }
  }
  return cleaned
}

async function buildWordList(): Promise<void> {
  const m = mem()
  m.building = true
  m.cache = null
  const beat = () => prisma.$executeRaw`UPDATE "SearchWordState" SET "buildingSince" = now() WHERE "id" = 'current'`
  try {
    await prisma.$executeRaw`
      INSERT INTO "SearchWordState" ("id", "buildingSince", "words") VALUES ('current', now(), 0)
      ON CONFLICT ("id") DO UPDATE SET "buildingSince" = now(), "error" = NULL`
    const cleaned = await cleanStoredHtml(beat)
    if (cleaned) console.log(`[website-search] ${cleaned.toLocaleString("en-GB")} descriptions cleaned of website HTML`)

    // ⚠ In batches, never one query over every description — that held the database for minutes
    // and starved the searches themselves. Each batch counts its words into the scratch table.
    await prisma.$executeRawUnsafe(`TRUNCATE "SearchWordBuild"`)
    let rows = 0
    for (const s of SOURCES) {
      let after = ""
      for (;;) {
        const r = await prisma.$queryRawUnsafe<{ last: string | null; n: number }[]>(`
          WITH b AS (
            SELECT "${s.key}" AS k, "description" AS d FROM "${s.table}"
            WHERE "${s.key}" > $1 ${s.where} ORDER BY "${s.key}" LIMIT ${BATCH}
          ), w AS (
            SELECT lower(x) AS raw FROM b, regexp_split_to_table(b.d, $2) AS x WHERE length(x) BETWEEN 3 AND 30
          ), ins AS (
            INSERT INTO "SearchWordBuild" ("raw", "n") SELECT raw, count(*)::int FROM w GROUP BY raw
            ON CONFLICT ("raw") DO UPDATE SET "n" = "SearchWordBuild"."n" + EXCLUDED."n"
          )
          SELECT max(k) AS last, count(*)::int AS n FROM b`, after, WORD_SPLIT)
        const got = Number(r[0]?.n ?? 0)
        if (!got || !r[0]?.last) break
        rows += got
        after = r[0].last
        await beat()
        if (got < BATCH) break
        await pause(100)
      }
      console.log(`[website-search] spelling list: read ${rows.toLocaleString("en-GB")} descriptions so far (${s.table} done)`)
    }

    // Swap in one short transaction: searches keep using the old list (MVCC) until the new one is
    // complete. Keyed on the FOLDED word; "forms" keeps the accented spellings seen (commonest first).
    // A word seen only once is left out — it's more likely a typo in an old description than a
    // spelling worth steering anyone towards.
    const n = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = 300000`)
      await tx.$executeRawUnsafe(`DELETE FROM "SearchWord"`)
      const n = await tx.$executeRawUnsafe(`
        INSERT INTO "SearchWord" ("word", "n", "forms")
        SELECT f, sum(n)::int, (array_agg(raw ORDER BY n DESC) FILTER (WHERE raw <> f))[1:5]
        FROM (SELECT raw, n, lower(translate(raw, $1, $2)) AS f FROM "SearchWordBuild") s
        GROUP BY f
        HAVING sum(n) >= 2`, FOLD_FROM, FOLD_TO)
      await tx.$executeRaw`
        UPDATE "SearchWordState" SET "builtAt" = now(), "words" = ${n}, "version" = ${BUILD_VERSION}, "buildingSince" = NULL, "error" = NULL
        WHERE "id" = 'current'`
      return n
    }, { timeout: 300_000, maxWait: 30_000 })
    await prisma.$executeRawUnsafe(`TRUNCATE "SearchWordBuild"`).catch(() => {})
    console.log(`[website-search] spelling list rebuilt: ${n.toLocaleString("en-GB")} words from ${rows.toLocaleString("en-GB")} descriptions`)
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500)
    console.warn("[website-search] spelling list build failed:", msg)
    await prisma.$executeRaw`UPDATE "SearchWordState" SET "buildingSince" = NULL, "error" = ${msg} WHERE "id" = 'current'`.catch(() => {})
  } finally {
    m.building = false
    m.cache = null
  }
}

/** The accented spellings our descriptions use for each word (marklin → märklin). Fails safe to none. */
export async function accentForms(words: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const ask = [...new Set(words)].filter(w => /^[a-z]+$/.test(w))
  if (!ask.length) return out
  try {
    const rows = await prisma.$queryRaw<{ word: string; forms: string[] | null }[]>`
      SELECT "word", "forms" FROM "SearchWord" WHERE "word" = ANY(${ask}::text[]) AND "forms" IS NOT NULL`
    for (const r of rows) if (r.forms?.length) out.set(r.word, r.forms)
  } catch { /* the list (or its forms column) isn't there yet */ }
  return out
}

/** Optimal-string-alignment distance: insertions, deletions, substitutions and swapped neighbours
 *  each cost one — so "stieff" is one step from "steiff". */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

export type Correction = { typed: string; also: string[] }

/** Real words to search as well as each typed word that looks misspelt. Fails safe to none. */
export async function spellingVariants(words: string[]): Promise<{ extra: Map<string, string[]>; corrections: Correction[] }> {
  const none = { extra: new Map<string, string[]>(), corrections: [] as Correction[] }
  const eligible = words.filter(w => w.length >= 4 && /^[a-z]+$/.test(w))
  if (!eligible.length) return none
  try {
    const rows = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL pg_trgm.similarity_threshold = 0.25`)
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = 3000`)
      return tx.$queryRaw<{ typed: string; word: string; n: number }[]>`
        SELECT q.word AS typed, s.word, s.n
        FROM unnest(${eligible}::text[]) AS q(word)
        CROSS JOIN LATERAL (
          SELECT sw."word", sw."n" FROM "SearchWord" sw
          WHERE sw."word" % q.word
          ORDER BY similarity(sw."word", q.word) DESC, sw."n" DESC
          LIMIT 20
        ) s`
    }, { timeout: 5_000, maxWait: 3_000 })

    const extra = new Map<string, string[]>()
    const corrections: Correction[] = []
    for (const typed of eligible) {
      const cands = rows.filter(r => r.typed === typed)
      const own = Number(cands.find(r => r.word === typed)?.n ?? 0)
      const maxD = typed.length <= 5 ? 1 : 2
      // A plural or singular of what they typed is already covered — don't report it as a "correction".
      const forms = new Set([typed, ...pluralVariants(typed), typed + "s", typed.replace(/s$/, "")])
      const good = cands
        .filter(r => !forms.has(r.word))
        .map(r => ({ word: r.word, n: Number(r.n), d: editDistance(r.word, typed) }))
        .filter(r => r.d <= maxD)
      // Only a word we barely know gets corrected; a real word only gains a far commoner near-twin.
      const picks = own < 3
        ? good.filter(r => r.n >= 3).sort((a, b) => a.d - b.d || b.n - a.n).slice(0, 2)
        : good.filter(r => r.d <= 1 && r.n >= 50 * own).sort((a, b) => b.n - a.n).slice(0, 1)
      if (picks.length) {
        extra.set(typed, picks.map(p => p.word))
        corrections.push({ typed, also: picks.map(p => p.word) })
      }
    }
    return { extra, corrections }
  } catch {
    return none
  }
}
