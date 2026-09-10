// What WE have actually made on the same thing before.
//
// Lifted out of /api/catalogue/lens so the Valuations tool uses the SAME search
// rather than a second copy that drifts — the scoring below was arrived at by
// measurement (see the notes on each rule) and is easy to get subtly wrong.
//
// Two reaches, ONE ranking (rank() below):
//  - The default (Valuations, Lotting Up): WarehouseItem only — 192k+ synced BC rows
//    carrying a real hammerPrice and an auction date. Quick, and called once per
//    item in a list.
//  - everywhere (Lens, 2026-09-10 — Jordan: "use this new search and database to
//    improve the lens as that is supposed to check our own lot"): ALSO the ABC
//    archive (948k lots, 1999–2023) and the website's FULL BC descriptions rather
//    than BC's 250-character short ones, with photos and links, and Website Search's
//    forgiving spellings (accents, plurals, "Dinky Toys" narrowing on "Dinky"). Two
//    scans of a million rows, a few seconds — one item at a time, never a list.

import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import { htmlToText } from "@/lib/html-text"
import { foldText, tokens, pluralVariants, accentForms, spellingState } from "@/lib/search-words"

export type Comparable = {
  description: string
  hammerPrice: number
  auctionDate: string | null
  auctionName: string | null
  category: string | null
  grouped: boolean
  // ── Filled only by the wide search Lens uses ──
  source?: "bc" | "abc"
  /** BC unique ID · ABC LotID */
  ident?: string | null
  saleCode?: string | null
  lot?: number | null
  photo?: string | null
  /** The lot on vectis.co.uk */
  link?: string | null
  /** Its description carries the catalogue number that was searched for. */
  exact?: boolean
}

/** Whatever the AI worked out about an item — enough to go looking for it. */
export type ComparableQuery = {
  maker?: string | null
  model?: string | null
  catalogueNumber?: string | null
  variant?: string | null
  searchTerms?: string[] | null
}

// ⚠ Group lots are the accuracy trap here. A lot of our archive reads
// "Corgi Unboxed Group Of Cars to include 261 James Bond…" — that £150 is for six
// cars, not for the one item. We flag them so callers can separate them out
// rather than averaging nonsense.
// Widened 2026-09-10 from lots the wide Lens search surfaced on production — a numbered
// list "(1) … (2) …", "a pair of", "a trio of", "Locos comprising …", and "Four 3029 locos
// Plus others" (£35, which had led the Märklin 3029 results). Each is several items' price.
const GROUPED = /\bgroup\b|\bto include\b|\bcollection of\b|\bquantity\b|\b\(\d+\)\s*$|\(1\)[\s\S]*\(2\)|\bpair of\b|\btrio of\b|\bplus others\b|\b(locos|locomotives|models|vehicles|figures|dolls|bears|cars|items|pieces|toys|wagons|coaches|stock|lorries|trucks|aircraft|books|comics|games|records)\s+comprising\b/i
// A quantity — "5 x assorted", "2 x Tank Locomotives", "dolls x five:" — counts ONLY near the
// start, where it describes the lot. Further in it describes a single product's contents:
// "R3514 … 5-Car Train Pack containing … 3 x Passenger Coaches" is ONE item, and matching it
// anywhere set aside every R3514 sale we have (measured). "1 x" stays single; "10 x 5cm" (a size)
// never matches — a letter must follow.
const QUANTITY_AT_START = /\b([2-9]|\d{2}) ?x [a-z]|\bx (two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i
const isGrouped = (desc: string) => GROUPED.test(desc) || QUANTITY_AT_START.test(desc.slice(0, 70))

// ⚠ Catalogue numbers must match as WHOLE words — a plain "contains" for Hornby
// R351 also matches R3514, a different train, which showed up at £190 in testing.
// ⚠ But apply it ONLY to number-bearing terms: forcing whole words on ordinary
// vocabulary breaks plurals, and "Steiff bear" then missed every "teddy bears"
// lot. So catalogue numbers are matched precisely and plain words stay fuzzy.
const looksLikeCatalogueNumber = (term: string) => /\d/.test(term)

function wholeWord(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i")
}

// Our archive writes the same reference several ways — "DB5", "D.B.5", "DB.5" —
// and drops apostrophes at random ("James Bond's" / "James Bonds"). Comparing
// with punctuation stripped from BOTH sides catches all of them: matching "DB5"
// against stripped descriptions finds 467 rows vs 449 raw. Accents are folded the
// same way Website Search folds them, so Märklin and Marklin are the same word.
const flatten = (s: string) => foldText(s).replace(/[.'’\-\s]/g, "")

const cleanTerms = (xs: string[] | null | undefined) =>
  (xs ?? []).map(t => String(t).trim()).filter(t => t.length >= 2 && t.length <= 40)

type Candidate = Omit<Comparable, "grouped"> & { key: string; photoKey?: string | null; sitePhoto?: string | null }

/**
 * ⚠⚠ SCORED, NOT ALL-OR-NOTHING. The first version required EVERY search term to
 * appear, which is why comparables "never worked": one over-specific term wiped
 * out the whole result. Measured 2026-07-30 —
 *   "Steiff + teddy bear + mohair + button in ear" → 0 matches; drop one → 436.
 *   "Hornby + OO gauge + Class 800 + GWR"          → 1 match;   drop two → 2,478.
 * Descriptive words (mohair, camouflage, "button in ear") rarely survive into a
 * lot description, so they must COUNT TOWARDS a match, never gate it.
 *
 * Shape: narrow in SQL on the maker plus ANY one strong term, then rank here by how
 * much else lines up. Never return nothing just because one word missed.
 */
function rank(rows: Candidate[], id: ComparableQuery): Candidate[] {
  const terms = cleanTerms(id.searchTerms)
  const number = id.catalogueNumber?.trim() ?? ""
  // Score: catalogue number is worth most (it's the definitive reference), then
  // each other term that turns up. Number matching stays whole-word so R351
  // never scores against R3514.
  const numberPattern = number && looksLikeCatalogueNumber(number) ? wholeWord(foldText(number)) : null
  const scoreTerms = [...new Set([id.model?.trim() ?? "", id.variant?.trim() ?? "", ...terms].filter(t => t.length >= 2))]

  const scored = rows.map(r => {
    const desc = foldText(r.description)
    const flat = flatten(r.description)
    let score = 0
    let numberHit = false
    if (number) {
      const hit = numberPattern ? numberPattern.test(desc) : flat.includes(flatten(number))
      if (hit) { score += 3; numberHit = true }
    }
    for (const t of scoreTerms) {
      if (looksLikeCatalogueNumber(t) ? wholeWord(foldText(t)).test(desc) : flat.includes(flatten(t))) score += 1
    }
    return { r, score, numberHit }
  })

  // Keep anything with real overlap. A catalogue-number hit alone is plenty.
  return scored
    .filter(s => s.numberHit || s.score >= 1)
    .sort((a, b) =>
      (b.numberHit ? 1 : 0) - (a.numberHit ? 1 : 0) ||
      b.score - a.score ||
      String(b.r.auctionDate ?? "").localeCompare(String(a.r.auctionDate ?? "")),
    )
    .slice(0, 40)
    .map(s => ({ ...s.r, exact: s.numberHit }))
}

export async function findComparables(id: ComparableQuery, opts: { everywhere?: boolean } = {}): Promise<Comparable[]> {
  if (opts.everywhere) return findEverywhere(id)

  const terms = cleanTerms(id.searchTerms)
  const maker  = id.maker?.trim() ?? ""
  const number = id.catalogueNumber?.trim() ?? ""

  // Strong signals worth narrowing on: the catalogue number, the model name, and
  // any term the model gave us. Weak/among-everything words are scored, not required.
  const strong = [number, id.model?.trim() ?? "", ...terms]
    .map(t => t.trim())
    .filter(t => t.length >= 2 && t.toLowerCase() !== maker.toLowerCase())
    .slice(0, 8)

  if (!maker && strong.length === 0) return []

  const anchor = maker
    ? { description: { contains: maker, mode: "insensitive" as const } }
    : null
  const anyStrong = strong.length > 0
    ? { OR: strong.map(t => ({ description: { contains: t, mode: "insensitive" as const } })) }
    : null

  const select = {
    uniqueId: true, description: true, hammerPrice: true,
    auctionDate: true, auctionName: true, category: true,
  }

  // ⚠ TWO queries, and the order matters. The broad query is capped at the most
  // RECENT rows, so on a common maker the genuine catalogue-number matches can be
  // truncated away before scoring ever sees them — "Dinky 741" ranked a Bedford
  // truck above the actual 741 Spitfires until this was split out. So when we have
  // a catalogue number, fetch those rows in their own right first.
  const numbered = number
    ? await prisma.warehouseItem.findMany({
        where: {
          hammerPrice: { gt: 0 },
          AND: [
            ...(anchor ? [anchor] : []),
            { description: { contains: number, mode: "insensitive" as const } },
          ],
        },
        select,
        orderBy: { auctionDate: "desc" },
        take: 120,
      })
    : []

  const broad = await prisma.warehouseItem.findMany({
    where: {
      hammerPrice: { gt: 0 },
      AND: [anchor, anyStrong].filter(Boolean) as object[],
    },
    select,
    orderBy: { auctionDate: "desc" },
    take: 300,
  })

  const byId = new Map<string, Candidate>()
  for (const r of [...numbered, ...broad]) {
    byId.set(r.uniqueId, {
      key: r.uniqueId,
      description: r.description ?? "",
      hammerPrice: r.hammerPrice ?? 0,
      auctionDate: r.auctionDate ?? null,
      auctionName: r.auctionName ?? null,
      category: r.category ?? null,
    })
  }

  return rank([...byId.values()], id).map(c => ({
    description: c.description,
    hammerPrice: c.hammerPrice,
    auctionDate: c.auctionDate,
    auctionName: c.auctionName,
    category:    c.category,
    grouped:     isGrouped(c.description),
  }))
}

// ── The wide search (Lens) ─────────────────────────────────────────────────────

// Words in a maker's name that descriptions usually leave out — "Dinky Toys" is
// written "Dinky" far more often, so the maker narrows on its distinctive word.
const GENERIC_MAKER_WORDS = new Set([
  "toys", "toy", "ltd", "limited", "company", "models", "model", "railways", "railway", "games",
  "products", "industries", "inc", "gmbh", "bros", "brothers", "sons", "manufacturing", "mfg",
])

const uniq = (xs: string[]) => [...new Set(xs)]
const like = (s: string) => "%" + s.replace(/[\\%_]/g, m => "\\" + m) + "%"
/** Drop any spelling that contains another one — "%train%" already finds "trains". */
const minimal = (xs: string[]) => uniq(xs).filter((x, _, all) => !all.some(y => y !== x && x.includes(y)))

/** The distinctive word of a maker's name: "Dinky Toys" → dinky, "Kämmer & Reinhardt" → kämmer. */
function makerWordOf(maker: string | null | undefined) {
  return tokens(maker ?? "").find(t => t.word.length >= 3 && !GENERIC_MAKER_WORDS.has(t.word)) ?? null
}

/** What to type into Website Search to see every match — Lens's "See every match" button. */
export function websiteSearchText(id: ComparableQuery): string {
  const maker = makerWordOf(id.maker)?.raw ?? ""
  const second = id.catalogueNumber?.trim() || tokens(id.model ?? "").slice(0, 3).map(t => t.raw).join(" ")
  return [maker, second].filter(Boolean).join(" ").slice(0, 120)
}

// Each source is capped, newest first — but catalogue-number matches sort to the top
// BEFORE the cap, so a common maker's newest lots can't crowd them out (the "Dinky 741"
// trap above, handled in one query instead of two).
const CAP = 300

type Row = {
  key: string; ident: string | null; sale_code: string | null; sale_name: string | null; lot: number | null
  description: string | null; hammer: number; sale_day: string | null; category: string | null
  photo_key: string | null; site_photo: string | null; site_link: string | null
}

async function findEverywhere(id: ComparableQuery): Promise<Comparable[]> {
  const terms = cleanTerms(id.searchTerms)
  const maker = id.maker?.trim() ?? ""
  const number = id.catalogueNumber?.trim() ?? ""
  const strong = uniq([number, id.model?.trim() ?? "", ...terms]
    .map(t => t.trim())
    .filter(t => t.length >= 2 && t.toLowerCase() !== maker.toLowerCase()))
    .slice(0, 6)
  const makerWord = makerWordOf(maker)
  if (!makerWord && strong.length === 0) return []

  // Accented spellings from Website Search's spelling list, once it's built (marklin → märklin).
  const ready = (await spellingState()).state === "ready"
  const forms = ready ? await accentForms([makerWord?.word ?? "", ...strong.map(foldText)]) : new Map<string, string[]>()
  const spellings = (term: string): string[] => {
    const raw = term.toLowerCase().trim()
    const folded = foldText(raw)
    const out = [raw, folded, folded.replace(/[.'’-]/g, "")]       // Tri-ang → triang
    if (/^[a-z]+$/.test(folded)) out.push(...pluralVariants(folded))
    out.push(...(forms.get(folded) ?? []))
    return uniq(out.filter(s => s.length >= 2))
  }
  const anyOf = (desc: Prisma.Sql, alts: string[]): Prisma.Sql => {
    const m = minimal(alts)
    return m.length === 1
      ? Prisma.sql`${desc} ILIKE ${like(m[0])}`
      : Prisma.sql`(${Prisma.join(m.map(a => Prisma.sql`${desc} ILIKE ${like(a)}`), " OR ")})`
  }
  // ⚠ The maker goes FIRST: it rules out most rows in a few comparisons, so the longer
  // list of strong terms is only tried on that maker's lots.
  const where = (desc: Prisma.Sql) => Prisma.join([
    ...(makerWord ? [anyOf(desc, spellings(makerWord.raw))] : []),
    ...(strong.length ? [anyOf(desc, strong.flatMap(spellings))] : []),
  ], " AND ")
  const numberFirst = (desc: Prisma.Sql) => (number ? Prisma.sql`(${anyOf(desc, spellings(number))}) DESC,` : Prisma.sql``)

  // ⚠ A cap on each query, inside a transaction because the pooler hands out a
  // connection per transaction (SET LOCAL stays put). Comparables are a bonus in Lens:
  // one source failing must not lose the other.
  const capped = (sql: Prisma.Sql) => prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = 15000`
    return tx.$queryRaw<Row[]>(sql)
  }, { timeout: 20_000, maxWait: 10_000 })

  const abcDesc = Prisma.sql`a."description"`
  const bcDesc = Prisma.sql`COALESCE(b."description", w."description")`
  const lotNo = Prisma.sql`NULLIF(regexp_replace(COALESCE(NULLIF(w."currentLotNo", '0'), w."lotNo"), '[^0-9]', '', 'g'), '')::int`
  const [abc, bc] = await Promise.allSettled([
    capped(Prisma.sql`
      SELECT a."id" AS key, a."lotId" AS ident, a."auctionId"::text AS sale_code, a."saleTitle" AS sale_name, a."lot" AS lot,
             a."description" AS description, a."hammerPrice"::float8 AS hammer, to_char(a."auctionDate", 'YYYY-MM-DD') AS sale_day,
             NULL::text AS category, a."photoKey" AS photo_key, a."sitePhoto" AS site_photo, a."siteLink" AS site_link
      FROM "ArchiveLot" a
      WHERE a."hammerPrice" > 0 AND ${where(abcDesc)}
      ORDER BY ${numberFirst(abcDesc)} a."auctionDate" DESC NULLS LAST
      LIMIT ${CAP}`),
    capped(Prisma.sql`
      SELECT w."uniqueId" AS key, w."uniqueId" AS ident, w."auctionCode" AS sale_code, w."auctionName" AS sale_name, ${lotNo} AS lot,
             ${bcDesc} AS description, w."hammerPrice"::float8 AS hammer, substr(w."auctionDate", 1, 10) AS sale_day,
             w."category" AS category, b."photoKey" AS photo_key, b."sitePhoto" AS site_photo, b."siteLink" AS site_link
      FROM "WarehouseItem" w LEFT JOIN "BcLotWeb" b ON b."uniqueId" = upper(w."uniqueId")
      WHERE w."hammerPrice" > 0 AND ${where(bcDesc)}
      ORDER BY ${numberFirst(bcDesc)} w."auctionDate" DESC NULLS LAST
      LIMIT ${CAP}`),
  ])
  if (abc.status === "rejected") console.error("comparables: the ABC search failed:", abc.reason)
  if (bc.status === "rejected") console.error("comparables: the BC search failed:", bc.reason)
  if (abc.status === "rejected" && bc.status === "rejected") throw bc.reason

  const cands: Candidate[] = []
  const add = (source: "abc" | "bc", rows: Row[]) => {
    for (const r of rows) {
      cands.push({
        key: `${source}:${r.key}`,
        source,
        // The website's BC text is being cleaned of HTML (lib/search-words.ts); this covers any row not done yet.
        description: htmlToText(r.description),
        hammerPrice: Number(r.hammer) || 0,
        auctionDate: r.sale_day,
        auctionName: r.sale_name,
        category: r.category,
        ident: r.ident,
        saleCode: r.sale_code,
        lot: r.lot,
        link: r.site_link ? `https://www.vectis.co.uk/${r.site_link.replace(/^\/+/, "")}` : null,
        photoKey: r.photo_key,
        sitePhoto: r.site_photo,
      })
    }
  }
  if (abc.status === "fulfilled") add("abc", abc.value)
  if (bc.status === "fulfilled") add("bc", bc.value)

  return Promise.all(rank(cands, id).map(async ({ key: _key, photoKey, sitePhoto, ...c }) => ({
    ...c,
    grouped: isGrouped(c.description),
    photo: photoKey
      ? await getSignedImageUrl(photoKey, 3600).catch(() => null)
      : sitePhoto ? SITE_IMAGES + sitePhoto.replace("/large/", "/medium/") : null,
  })))
}

export type ComparableSummary = {
  /** Single-item sales only — the ones a per-item figure can honestly rest on. */
  count: number
  median: number
  low: number
  high: number
  /** Group lots found and deliberately EXCLUDED from the figures above. */
  groupedExcluded: number
  mostRecent: string | null
}

/**
 * What our own archive says this is worth.
 *
 * ⚠ Group lots are excluded from every figure — a "group of six to include…"
 * price is for the group, so averaging it into a single-item valuation inflates
 * it. They're counted separately so the UI can say they were set aside.
 *
 * Median, not mean: one exceptional result (a mint boxed example among playworn
 * ones) drags a mean well above what a normal example makes, and this tool is
 * meant to come in UNDER the real figure, never over.
 */
export function summariseComparables(list: Comparable[]): ComparableSummary | null {
  const singles = list.filter(c => !c.grouped && c.hammerPrice > 0)
  if (singles.length === 0) return null

  const prices = singles.map(c => c.hammerPrice).sort((a, b) => a - b)
  const mid = Math.floor(prices.length / 2)
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2

  // Trim the extremes so a single freak result doesn't become the "high".
  const pct = (p: number) => prices[Math.min(prices.length - 1, Math.max(0, Math.floor(prices.length * p)))]

  const dates = singles.map(c => c.auctionDate).filter((d): d is string => !!d).sort()

  return {
    count: singles.length,
    median,
    low:  prices.length >= 4 ? pct(0.25) : prices[0],
    high: prices.length >= 4 ? pct(0.75) : prices[prices.length - 1],
    groupedExcluded: list.length - singles.length,
    mostRecent: dates.length ? dates[dates.length - 1] : null,
  }
}
