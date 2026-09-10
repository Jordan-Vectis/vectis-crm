import { prisma } from "@/lib/prisma"
import { htmlToText, HTML_IN_TEXT_SQL } from "@/lib/html-text"

// 🔎 Website Search — making the search forgiving (Jordan, 2026-09-10: "if I add a , anywhere it
// doesn't find that one lot — the search needs to be a bit smarter"; "Kämmer & Reinhardt" found
// nothing because the lot says "Kammer").
//
// Three things, all built from our own data — nothing external, no AI call per search:
//  1. TIDY WORDS — punctuation stripped, little words ("&", "and", "the") ignored, accents folded
//     on BOTH sides (Kämmer = Kammer, Märklin = Marklin), capitals never matter.
//  2. PLURALS — "buses" also finds "bus", "lorry" also finds "lorries".
//  3. TYPOS — a spelling list of every word in our 1.2 million descriptions, with how often it
//     appears, so "Reinhart", "Stieff" or "Merrythougt" also search the real word. Candidates come
//     from a trigram index (pg_trgm) and are confirmed by edit distance here, which catches swapped
//     letters (Stieff/Steiff) that trigrams alone score badly. Only unknown or rare words are
//     corrected, and the page says what it also searched for, so it's never a mystery.

// ⚠ The SAME map on both sides: translate() in SQL, foldText() here. Change one, change both.
// (translate is 1-to-1, so "ß" → "ss" can't be done; it's rare in our descriptions.)
export const FOLD_FROM = "ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÇçÑñÝýÿ"
export const FOLD_TO   = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuCcNnYyy"

/** Accents folded with the same map the database uses, then lower-cased. */
export function foldText(s: string): string {
  let out = ""
  for (const ch of s) {
    const i = FOLD_FROM.indexOf(ch)
    out += i >= 0 ? FOLD_TO[i] : ch
  }
  return out.toLowerCase()
}

const STOP_WORDS = new Set(["and", "the", "of", "with", "a", "an", "in", "to", "for", "by", "on", "at", "or"])

/** The words to search for: accents folded, lower case, punctuation stripped, little words dropped
 *  (unless they're all there is). Hyphens, dots and slashes INSIDE a word are kept — codes like
 *  R009030-1, No.102 and 1/43 need them. */
export function tokenise(q: string, max = 8): string[] {
  const parts = foldText(q).split(/[\s,;:!?()[\]{}<>"“”‘’'&+|*#~`=_\\]+/)
  const words = parts.map(p => p.replace(/^[-./]+|[-./]+$/g, "")).filter(w => w.length >= 2)
  const kept = words.filter(w => !STOP_WORDS.has(w))
  return [...new Set(kept.length ? kept : words)].slice(0, max)
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

type Mem = { building: boolean; lastAttempt: number; cache: { state: SpellingState; builtAt: number | null; at: number } | null }
function mem(): Mem {
  const g = globalThis as unknown as { _searchWords?: Mem }
  return (g._searchWords ??= { building: false, lastAttempt: 0, cache: null })
}

const REBUILD_AFTER_MS = 7 * 86_400_000
const RETRY_AFTER_MS = 60 * 60_000

/** Is the spelling list there to use? Cached for a minute — it's asked on every search. */
export async function spellingState(): Promise<{ state: SpellingState; builtAt: number | null }> {
  const m = mem()
  const now = Date.now()
  if (m.cache && now - m.cache.at < 60_000) return m.building && m.cache.state !== "ready" ? { ...m.cache, state: "building" } : m.cache
  try {
    const rows = await prisma.$queryRaw<{ builtAt: Date | null; words: number; buildingSince: Date | null }[]>`
      SELECT "builtAt", "words", "buildingSince" FROM "SearchWordState" WHERE "id" = 'current'`
    const r = rows[0]
    const building = m.building || (!!r?.buildingSince && now - r.buildingSince.getTime() < 30 * 60_000)
    // An old list is still perfectly usable while a new one is being built.
    const state: SpellingState = r?.builtAt && Number(r.words) > 0 ? "ready" : building ? "building" : "unavailable"
    m.cache = { state, builtAt: r?.builtAt?.getTime() ?? null, at: now }
  } catch {
    // Before Run Migrations the table isn't there — the search simply works without spelling help.
    m.cache = { state: "unavailable", builtAt: null, at: now }
  }
  return m.cache
}

/** London evening or night — when a rebuild won't slow anyone down. */
function quietHour(): boolean {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date())) % 24
  return h >= 19 || h < 7
}

/** Builds the list the first time it's needed, and refreshes it weekly (evenings only). Never waits:
 *  the search that set it off carries on without spelling help. ⚠ In-process, like the other Hub
 *  jobs — a deploy mid-build just means the next search starts it again. */
export function kickWordListBuild(): void {
  void (async () => {
    const m = mem()
    if (m.building || Date.now() - m.lastAttempt < RETRY_AFTER_MS) return
    const s = await spellingState()
    const age = s.builtAt ? Date.now() - s.builtAt : Infinity
    const needed = s.state === "unavailable" || (s.state === "ready" && age > REBUILD_AFTER_MS && quietHour())
    if (!needed) return
    try {
      const t = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('"SearchWord"') IS NOT NULL AS ok`
      if (!t[0]?.ok) return // not migrated yet
    } catch { return }
    m.lastAttempt = Date.now()
    await buildWordList()
  })().catch(() => { /* never let a background build take anything down */ })
}

// Every word in our descriptions (accents folded, letters only, 3–30 long) with how often it
// appears. A word seen only once is left out — it's more likely a typo in an old description than a
// spelling worth steering anyone towards. BC's short descriptions are skipped: the website's full
// ones (BcLotWeb) already contain them.
const BUILD_SQL = `
  WITH src AS (
    SELECT translate("description", '${FOLD_FROM}', '${FOLD_TO}') AS d FROM "ArchiveLot"
    UNION ALL SELECT translate("description", '${FOLD_FROM}', '${FOLD_TO}') FROM "BcLotWeb" WHERE "description" IS NOT NULL
    UNION ALL SELECT translate("description", '${FOLD_FROM}', '${FOLD_TO}') FROM "CatalogueLot" WHERE "description" <> ''
  )
  SELECT w AS word, count(*)::int AS n
  FROM src, regexp_split_to_table(lower(src.d), '[^a-z]+') AS w
  WHERE length(w) BETWEEN 3 AND 30
  GROUP BY w
  HAVING count(*) >= 2`

/** Step 1 of every build: turn any description still holding the website's HTML into plain text
 *  (BcLotWeb nearly all of it; a few ABC rows). Only rows that still carry tags or entities are
 *  touched, 500 at a time in key order, so it's cheap once done and safe to repeat. New lots arrive
 *  clean already — lib/archive-site.ts runs htmlToText before it stores them. */
async function cleanStoredHtml(): Promise<number> {
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
    }
  }
  return cleaned
}

async function buildWordList(): Promise<void> {
  const m = mem()
  m.building = true
  m.cache = null
  try {
    await prisma.$executeRaw`
      INSERT INTO "SearchWordState" ("id", "buildingSince", "words") VALUES ('current', now(), 0)
      ON CONFLICT ("id") DO UPDATE SET "buildingSince" = now(), "error" = NULL`
    const cleaned = await cleanStoredHtml()
    if (cleaned) console.log(`[website-search] ${cleaned.toLocaleString("en-GB")} descriptions cleaned of website HTML`)
    // ⚠ One transaction: searches keep using the old list (MVCC) until the new one is complete.
    // DELETE rather than TRUNCATE for the same reason — TRUNCATE would lock searches out meanwhile.
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = 900000`)
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE sw_new ON COMMIT DROP AS ${BUILD_SQL}`)
      await tx.$executeRawUnsafe(`DELETE FROM "SearchWord"`)
      const n = await tx.$executeRawUnsafe(`INSERT INTO "SearchWord" ("word", "n") SELECT word, n FROM sw_new`)
      await tx.$executeRaw`UPDATE "SearchWordState" SET "builtAt" = now(), "words" = ${n}, "buildingSince" = NULL, "error" = NULL WHERE "id" = 'current'`
    }, { timeout: 900_000, maxWait: 30_000 })
    console.log("[website-search] spelling list rebuilt")
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 500)
    console.warn("[website-search] spelling list build failed:", msg)
    await prisma.$executeRaw`UPDATE "SearchWordState" SET "buildingSince" = NULL, "error" = ${msg} WHERE "id" = 'current'`.catch(() => {})
  } finally {
    m.building = false
    m.cache = null
  }
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
