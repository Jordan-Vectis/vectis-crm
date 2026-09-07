import { prisma } from "@/lib/prisma"
import { uploadBufferToR2 } from "@/lib/r2"

// Lot Archive ← vectis.co.uk. Two resumable server-side jobs, started from the
// archive page and left to run (they survive the tab closing, not a redeploy — press
// the button again and they carry on from where they were):
//
//   "site"   Walk the website's own sale ids upwards. Each sale's page gives its title
//            and date; the site's lot feed (the same JSON its catalogue pages load)
//            gives every lot with its lot number, the OLD SYSTEM'S LotID (the site
//            calls it unique_id), the photo path, description, estimates and hammer.
//            Matched to the archive by AuctionID (the first number of the sale's URL,
//            e.g. /bidding/724-doll-teddy-bear-sale-683 = AuctionID 724, site id 683)
//            + lot number; rows the sheet never had are created from the site.
//   "photos" Copy each lot's main photo into R2 so the pictures are ours whatever
//            happens to the site. ~23 KB each at "large".
//
// Measured 2026-09-07: site id 15 = 12 Dec 2008 Model Train Sale, 609 lots in one
// feed request, every one with a LotID; photos are served straight from S3 by LotID
// (checked 2008, 2019 and 2023 lots). Oldest sale on the site is Feb 2006.
// ⚠ Be polite: one request every PAUSE ms, an honest User-Agent, only finished sales.

const SITE = "https://www.vectis.co.uk"
export const SITE_IMAGES = "https://am-s3-bucket-assets.s3.eu-west-2.amazonaws.com/vectis/prod/"
const UA = "VectisHub archive (IT@vectis.co.uk)"
const PAUSE = 250
const MISSES_TO_STOP = 40          // this many empty site ids in a row = we're past the newest sale
const FEED_PAGE = 500

type Ctl = { stop: boolean }
const active = new Map<string, Ctl>()
export const isActive = (id: string) => active.has(id)
export function requestStop(id: string): boolean { const c = active.get(id); if (c) c.stop = true; return !!c }

export async function getJob(id: "site" | "photos") {
  const j = await prisma.archiveJob.findUnique({ where: { id } })
  return j ? { ...j, running: isActive(id) } : null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, " ")
const num = (v: unknown): number | null => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[£$,\s]/g, "")); return Number.isFinite(n) ? n : null }
const str = (v: unknown): string | null => { const s = v == null ? "" : String(v).trim(); return s ? s : null }

async function fetchSalePage(siteId: number): Promise<{ title: string; date: Date | null }> {
  const res = await fetch(`${SITE}/bidding/0-x-${siteId}`, { headers: { "User-Agent": UA }, cache: "no-store" })
  const html = res.ok ? await res.text() : ""
  const t = html.match(/<title>\s*Vectis Auctions\s*\|\s*([^<]*)<\/title>/i)
  const d = html.match(/\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/)
  return { title: decode(t?.[1] ?? "").trim(), date: d ? new Date(Date.UTC(+d[3], MONTHS.indexOf(d[2]), +d[1])) : null }
}

type FeedLot = {
  lot_number: unknown; id: unknown; unique_id: unknown; image: unknown; description: unknown; meta: unknown
  low_estimate: unknown; high_estimate: unknown; hammer_price: unknown; sold: unknown; withdrawn: unknown
  sef_link: unknown; isFinished: unknown
}

async function fetchFeed(siteId: number, page: number): Promise<{ lots: FeedLot[]; total: number }> {
  const body = new URLSearchParams({
    per_page: String(FEED_PAGE), current_page: String(page), auction_id: String(siteId), lot_order: "", sale_type: "", keyword: "",
    cate_arr: "[]", sub_cate_arr: "[]", extended_attrs_obj: "{}", low_estimate: "", high_estimate: "", catalogue_layout_header_id: "0",
  })
  const res = await fetch(`${SITE}/index.php?option=com_bidding&format=json&task=commission.getLots`, {
    method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store",
  })
  if (!res.ok) throw new Error(`The website's lot feed answered ${res.status} for sale ${siteId}`)
  const j: any = await res.json().catch(() => ({}))
  return { lots: Array.isArray(j?.lots) ? j.lots : [], total: Number(j?.total_lots) || 0 }
}

async function fetchAllLots(siteId: number): Promise<FeedLot[]> {
  const out: FeedLot[] = []
  for (let p = 1; p <= 40; p++) {
    const { lots, total } = await fetchFeed(siteId, p)
    out.push(...lots)
    if (!lots.length || lots.length < FEED_PAGE || out.length >= total) break
    await sleep(PAUSE)
  }
  return out
}

const slugTitle = (sef: unknown) => {
  const m = String(sef ?? "").match(/^bidding\/\d+-(.+?)-\d+\//)
  return m ? m[1].split("-").map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ") : ""
}

/**
 * Writes one finished sale's lots: new rows created from the site, existing rows given
 * their photo/site hammer. ⚠ Matched on LotID (the site's unique_id) — sale + lot number
 * is not unique in the old data (multi-day sales re-used lot numbers).
 */
async function writeSale(auctionId: number, title: string, date: Date | null, lots: FeedLot[]): Promise<{ matched: number; added: number }> {
  const existing = new Set((await prisma.archiveLot.findMany({ where: { auctionId }, select: { lotId: true } })).map(r => r.lotId).filter((x): x is string => !!x))
  const clean = lots.map(l => ({ l, lot: Math.round(Number(l.lot_number)), lotId: str(l.unique_id) })).filter(x => Number.isFinite(x.lot) && x.lotId)
  const seen = new Set<string>()
  const uniq = clean.filter(x => (seen.has(x.lotId!) ? false : (seen.add(x.lotId!), true)))
  const toAdd = uniq.filter(x => !existing.has(x.lotId!)), toMatch = uniq.filter(x => existing.has(x.lotId!))
  const hammer = (l: FeedLot) => (Number(l.sold) ? num(l.hammer_price) : null)

  let added = 0
  if (toAdd.length) {
    const res = await prisma.archiveLot.createMany({
      data: toAdd.map(({ l, lot }) => ({
        auctionId, lot, auctionDate: date, saleTitle: title,
        description: String(l.description ?? "").trim(),
        estimateLow: num(l.low_estimate), estimateHigh: num(l.high_estimate),
        hammerPrice: hammer(l), siteHammerPrice: hammer(l),
        lotId: str(l.unique_id), siteLotId: Number.isFinite(Number(l.id)) ? Math.round(Number(l.id)) : null,
        sitePhoto: str(l.image), source: "site",
      })),
      skipDuplicates: true,
    })
    added = res.count
  }
  if (toMatch.length) {
    // One statement per sale. Numbers travel as text and are cast in SQL so nulls are
    // never a driver question. The sheet's own figures are kept; only blanks are filled.
    const lotIds = toMatch.map(x => x.lotId!)
    const siteIds = toMatch.map(x => (Number.isFinite(Number(x.l.id)) ? String(Math.round(Number(x.l.id))) : ""))
    const photos = toMatch.map(x => str(x.l.image) ?? "")
    const hammers = toMatch.map(x => { const h = hammer(x.l); return h == null ? "" : String(h) })
    const los = toMatch.map(x => { const n = num(x.l.low_estimate); return n == null ? "" : String(n) })
    const his = toMatch.map(x => { const n = num(x.l.high_estimate); return n == null ? "" : String(n) })
    await prisma.$executeRaw`
      UPDATE "ArchiveLot" a SET
        "siteLotId"       = NULLIF(v."siteLotId", '')::int,
        "sitePhoto"       = COALESCE(NULLIF(v."photo", ''), a."sitePhoto"),
        "siteHammerPrice" = NULLIF(v."hammer", '')::float8,
        "saleTitle"       = CASE WHEN a."saleTitle" = '' THEN ${title} ELSE a."saleTitle" END,
        "auctionDate"     = COALESCE(a."auctionDate", ${date}::timestamp),
        "estimateLow"     = COALESCE(a."estimateLow", NULLIF(v."lo", '')::float8),
        "estimateHigh"    = COALESCE(a."estimateHigh", NULLIF(v."hi", '')::float8)
      FROM unnest(${lotIds}::text[], ${siteIds}::text[], ${photos}::text[], ${hammers}::text[], ${los}::text[], ${his}::text[])
        AS v("lotId", "siteLotId", "photo", "hammer", "lo", "hi")
      WHERE a."auctionId" = ${auctionId} AND a."lotId" = v."lotId"`
  }
  return { matched: toMatch.length, added }
}

// ── "site" job ──────────────────────────────────────────────────────────────

export async function startSitePull(startedBy: string) {
  if (isActive("site")) return getJob("site")
  let job = await prisma.archiveJob.upsert({ where: { id: "site" }, create: { id: "site", startedBy }, update: { error: null, startedBy } })
  if (job.done) {
    // Run again: from the first sale that wasn't finished last time (or after the last one seen).
    const [firstOpen, last] = await Promise.all([
      prisma.archiveSale.findFirst({ where: { finished: false }, orderBy: { siteId: "asc" }, select: { siteId: true } }),
      prisma.archiveSale.findFirst({ orderBy: { siteId: "desc" }, select: { siteId: true } }),
    ])
    const cursor = Math.max(0, (firstOpen?.siteId ?? (last?.siteId ?? 0) + 1) - 1)
    job = await prisma.archiveJob.update({ where: { id: "site" }, data: { cursor, done: false, sales: 0, matched: 0, added: 0, note: null } })
  }
  void runSitePull()
  return { ...job, running: true }
}

async function runSitePull() {
  const ctl: Ctl = { stop: false }; active.set("site", ctl)
  try {
    const job = await prisma.archiveJob.findUniqueOrThrow({ where: { id: "site" } })
    let cursor = job.cursor, misses = 0
    while (!ctl.stop) {
      const siteId = cursor + 1
      const known = await prisma.archiveSale.findUnique({ where: { siteId } })
      if (known?.finished && known.lots > 0) {                            // pulled on an earlier run — skip without touching the site
        cursor = siteId; await prisma.archiveJob.update({ where: { id: "site" }, data: { cursor } }); continue
      }
      const page = await fetchSalePage(siteId); await sleep(PAUSE)
      const lots = await fetchAllLots(siteId)
      if (!lots.length && !page.title) {
        misses++
        if (misses >= MISSES_TO_STOP) { await prisma.archiveJob.update({ where: { id: "site" }, data: { done: true, note: `Finished — nothing beyond sale ${siteId - misses}` } }); break }
        cursor = siteId; await sleep(PAUSE); continue
      }
      misses = 0
      const m = String(lots[0]?.sef_link ?? "").match(/^bidding\/(\d+)-/)
      const auctionId = m ? +m[1] : null
      const finished = lots.length > 0 && lots.every(l => !!l.isFinished)
      const title = page.title || slugTitle(lots[0]?.sef_link) || `Sale ${siteId}`
      await prisma.archiveSale.upsert({
        where: { siteId },
        create: { siteId, auctionId, title, saleDate: page.date, lots: lots.length, finished },
        update: { auctionId, title, saleDate: page.date, lots: lots.length, finished, pulledAt: new Date() },
      })
      let matched = 0, added = 0
      if (finished && auctionId != null) ({ matched, added } = await writeSale(auctionId, title, page.date, lots))
      cursor = siteId
      await prisma.archiveJob.update({
        where: { id: "site" },
        data: { cursor, sales: { increment: 1 }, matched: { increment: matched }, added: { increment: added }, note: `Sale ${siteId} · ${title} · ${lots.length} lots${finished ? "" : " (not finished yet — skipped)"}` },
      })
      await sleep(PAUSE)
    }
  } catch (e: any) {
    console.error("archive site pull error:", e)
    await prisma.archiveJob.update({ where: { id: "site" }, data: { error: e?.message ?? "Stopped with an error" } }).catch(() => {})
  } finally { active.delete("site") }
}

// ── "photos" job ────────────────────────────────────────────────────────────

// Two copies per lot: the site's "large" (~23 KB) for display, and its "xlarge"
// (~250 KB, the best it holds — there are no originals) as the backup, so a future
// move off the website has the full-quality pictures. ~260 GB for the whole archive.
const PHOTO_TODO = { sitePhoto: { not: null }, OR: [{ photoKey: null }, { photoXlKey: null }] } as const

export async function startPhotoCopy(startedBy: string) {
  if (isActive("photos")) return getJob("photos")
  const total = await prisma.archiveLot.count({ where: PHOTO_TODO })
  const job = await prisma.archiveJob.upsert({
    where: { id: "photos" },
    create: { id: "photos", startedBy, total },
    update: { error: null, startedBy, total, done: false, added: 0, note: null },
  })
  void runPhotoCopy()
  return { ...job, running: true }
}

async function runPhotoCopy() {
  const ctl: Ctl = { stop: false }; active.set("photos", ctl)
  try {
    while (!ctl.stop) {
      const batch = await prisma.archiveLot.findMany({ where: PHOTO_TODO, select: { id: true, lotId: true, sitePhoto: true, photoKey: true, photoXlKey: true }, take: 40, orderBy: { id: "asc" } })
      if (!batch.length) { await prisma.archiveJob.update({ where: { id: "photos" }, data: { done: true, note: "Every photo the site has is in the Hub, display and full-size" } }); break }
      let n = 0
      const grab = async (path: string): Promise<Buffer | null> => {           // null = the site has no such file
        const res = await fetch(SITE_IMAGES + path, { headers: { "User-Agent": UA } })
        if (res.status === 404 || res.status === 403) return null
        if (!res.ok) throw new Error(`Photo download answered ${res.status}`)
        return Buffer.from(await res.arrayBuffer())
      }
      for (let i = 0; i < batch.length && !ctl.stop; i += 5) {
        await Promise.all(batch.slice(i, i + 5).map(async l => {
          const safe = String(l.lotId || l.id).replace(/[^A-Za-z0-9_-]/g, "")
          const data: { photoKey?: string; photoXlKey?: string; sitePhoto?: null } = {}
          if (!l.photoKey) {
            const buf = await grab(l.sitePhoto!)
            if (!buf) { await prisma.archiveLot.update({ where: { id: l.id }, data: { sitePhoto: null } }); return }   // the site has no picture after all
            data.photoKey = `archive-photos/${safe}.webp`
            await uploadBufferToR2(buf, data.photoKey, "image/webp")
          }
          if (!l.photoXlKey) {
            const buf = await grab(l.sitePhoto!.replace("/large/", "/xlarge/"))
            if (buf) { data.photoXlKey = `archive-photos/xl/${safe}.webp`; await uploadBufferToR2(buf, data.photoXlKey, "image/webp") }
            else data.photoXlKey = data.photoKey ?? l.photoKey ?? undefined                       // no full-size on the site: the display copy is the best there is
          }
          await prisma.archiveLot.update({ where: { id: l.id }, data })
          n++
        }))
        await sleep(100)
      }
      await prisma.archiveJob.update({ where: { id: "photos" }, data: { added: { increment: n }, note: null } })
    }
  } catch (e: any) {
    console.error("archive photo copy error:", e)
    await prisma.archiveJob.update({ where: { id: "photos" }, data: { error: e?.message ?? "Stopped with an error" } }).catch(() => {})
  } finally { active.delete("photos") }
}
