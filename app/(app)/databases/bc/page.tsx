import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@/app/generated/prisma/client"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"
import ArchiveSite from "../archive/archive-site"
import BcCollect from "./bc-collect"

// Databases → BC Database: every Business Central lot that has been through a sale,
// built like the ABC database. The lot's own figures (sale, lot number, estimate,
// hammer, short description) come from the nightly BC sync (WarehouseItem); the long
// description, the photo and the link to vectis.co.uk come from the website pull
// (BcLotWeb) — BC's API has no long description at all. Server-rendered, 100 a page.
const PAGE = 100
const fmtGBP = (n: number | null) => n == null ? "—" : "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 0 })
const fmtDate = (s: string | null) => { if (!s) return "—"; const d = new Date(s + "T00:00:00Z"); return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) }

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""

type Row = { id: string; uniqueId: string; auctionCode: string | null; auctionName: string | null; auctionDate: string | null; lotNo: number | null; shortDesc: string | null; longDesc: string | null; estimateLow: number | null; estimateHigh: number | null; hammerPrice: number | null; siteHammerPrice: number | null; siteLink: string | null; sitePhoto: string | null; photoKey: string | null; photoXlKey: string | null; noOfPhotos: number | null; photo?: string | null; photoFull?: string | null }

export default async function BcDatabasePage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth()
  const isAdmin = session?.user?.role === "ADMIN"
  const sp = await searchParams
  const q = one(sp.q).trim(), year = one(sp.year).trim(), sale = one(sp.sale).trim()
  const order = one(sp.order).trim()
  const min = parseFloat(one(sp.min)), max = parseFloat(one(sp.max))
  const page = Math.max(1, parseInt(one(sp.page)) || 1)

  // Only lots that have been through a sale that has happened: a sale code, a lot number, a date not in the future.
  const conds: Prisma.Sql[] = [Prisma.sql`w."auctionCode" IS NOT NULL AND w."auctionDate" IS NOT NULL AND w."auctionDate" <= to_char(now(), 'YYYY-MM-DD') AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL`]
  if (q) conds.push(Prisma.sql`(w."description" ILIKE ${"%" + q + "%"} OR b."description" ILIKE ${"%" + q + "%"} OR w."auctionName" ILIKE ${"%" + q + "%"})`)
  if (sale) conds.push(Prisma.sql`w."auctionName" ILIKE ${"%" + sale + "%"}`)
  if (/^\d{4}$/.test(year)) conds.push(Prisma.sql`w."auctionDate" LIKE ${year + "-%"}`)
  if (Number.isFinite(min)) conds.push(Prisma.sql`w."hammerPrice" >= ${min}`)
  if (Number.isFinite(max)) conds.push(Prisma.sql`w."hammerPrice" <= ${max} AND w."hammerPrice" > 0`)
  const where = Prisma.join(conds, " AND ")
  const from = Prisma.sql`FROM "WarehouseItem" w LEFT JOIN "BcLotWeb" b ON b."uniqueId" = upper(w."uniqueId")`
  // ⚠ Built from a fixed map, never from the query string — this goes into raw SQL, so anything a
  // visitor could influence must not reach it. An unknown value simply falls back to the default.
  // ⚠ Unsold lots (hammer 0) sort LAST on both price directions: a lot with no result is not the
  // cheapest, and letting the nulls lead a low-to-high sort buries the genuinely cheap ones.
  const LOT_NO = Prisma.sql`NULLIF(regexp_replace(COALESCE(NULLIF(w."currentLotNo", '0'), w."lotNo"), '[^0-9]', '', 'g'), '')::int`
  const ORDERS: Record<string, Prisma.Sql> = {
    "":         Prisma.sql`w."auctionDate" DESC, w."auctionCode" DESC, ${LOT_NO} ASC`,
    oldest:     Prisma.sql`w."auctionDate" ASC, w."auctionCode" ASC, ${LOT_NO} ASC`,
    price_desc: Prisma.sql`NULLIF(w."hammerPrice", 0) DESC NULLS LAST, w."auctionDate" DESC`,
    price_asc:  Prisma.sql`NULLIF(w."hammerPrice", 0) ASC NULLS LAST, w."auctionDate" DESC`,
    lot:        Prisma.sql`w."auctionCode" DESC, ${LOT_NO} ASC`,
  }
  const orderBy = ORDERS[order] ?? ORDERS[""]

  type Stats = { n: number; sales: number; from: string | null; to: string | null; hammer: number; sold: number; longDesc: number; inHub: number; fullSize: number; siteOnly: number; noPhoto: number }
  let rows: Row[] = [], total = 0, stats: Stats | null = null, tableError: string | null = null
  try {
    const [r, t, agg] = await Promise.all([
      prisma.$queryRaw<Row[]>`
        SELECT w."id", w."uniqueId", w."auctionCode", w."auctionName", w."auctionDate",
               NULLIF(regexp_replace(COALESCE(NULLIF(w."currentLotNo", '0'), w."lotNo"), '[^0-9]', '', 'g'), '')::int AS "lotNo",
               w."description" AS "shortDesc", b."description" AS "longDesc", w."lowEstimate" AS "estimateLow", w."highEstimate" AS "estimateHigh",
               NULLIF(w."hammerPrice", 0) AS "hammerPrice", b."siteHammerPrice", b."siteLink", b."sitePhoto", b."photoKey", b."photoXlKey", w."noOfPhotos"
        ${from} WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n ${from} WHERE ${where}`,
      prisma.$queryRaw<{ n: bigint; sales: bigint; from: string | null; to: string | null; hammer: number | null; sold: bigint; longdesc: bigint; inhub: bigint; fullsize: bigint; siteonly: bigint }[]>`
        SELECT count(*)::bigint AS n, count(DISTINCT w."auctionCode")::bigint AS sales, min(w."auctionDate") AS "from", max(w."auctionDate") AS "to",
               sum(w."hammerPrice")::float8 AS hammer, count(*) FILTER (WHERE w."hammerPrice" > 0)::bigint AS sold,
               count(b."description")::bigint AS longdesc, count(b."photoKey")::bigint AS inhub,
               count(*) FILTER (WHERE b."photoXlKey" LIKE 'bc-photos/xl/%')::bigint AS fullsize,
               count(*) FILTER (WHERE b."photoKey" IS NULL AND b."sitePhoto" IS NOT NULL)::bigint AS siteonly
        ${from} WHERE w."auctionCode" IS NOT NULL AND w."auctionDate" IS NOT NULL AND w."auctionDate" <= to_char(now(), 'YYYY-MM-DD') AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL`,
    ])
    rows = r; total = Number(t[0]?.n ?? 0)
    const a = agg[0]; const n = Number(a?.n ?? 0), inHub = Number(a?.inhub ?? 0), siteOnly = Number(a?.siteonly ?? 0)
    stats = { n, sales: Number(a?.sales ?? 0), from: a?.from ?? null, to: a?.to ?? null, hammer: a?.hammer ?? 0, sold: Number(a?.sold ?? 0), longDesc: Number(a?.longdesc ?? 0), inHub, fullSize: Number(a?.fullsize ?? 0), siteOnly, noPhoto: n - inHub - siteOnly }
    await Promise.all(rows.map(async row => {
      row.photo = row.photoKey ? await getSignedImageUrl(row.photoKey, 3600).catch(() => null)
        : row.sitePhoto ? SITE_IMAGES + String(row.sitePhoto).replace("/large/", "/medium/") : null
      row.photoFull = row.photoXlKey ? await getSignedImageUrl(row.photoXlKey, 3600).catch(() => row.photo)
        : row.sitePhoto ? SITE_IMAGES + String(row.sitePhoto).replace("/large/", "/xlarge/") : row.photo
    }))
  } catch (e: any) {
    tableError = /does not exist|relation/i.test(String(e?.message)) ? "The BC Database table isn't there yet — Run Migrations on this environment first." : (e?.message ?? "Couldn't read the BC database")
  }
  const pages = Math.max(1, Math.ceil(total / PAGE))

  // Sensible sale numbers for the browser collector, worked out rather than guessed: start just
  // before the first Business Central sale, finish past the newest sale the site walk ever saw.
  // ⚠ The walk is what has stalled, so its last sale is behind today's — hence the margin. Sale
  // numbers past the end cost one quick request each, and the script stops itself after 80 empties.
  let collect = { from: 1, to: 5000, basis: "" }
  if (isAdmin) {
    try {
      const [firstBc, newest] = await Promise.all([
        prisma.$queryRaw<{ d: string | null }[]>`SELECT min("auctionDate") AS d FROM "WarehouseItem" WHERE "auctionDate" IS NOT NULL AND "auctionDate" <> ''`,
        prisma.archiveSale.findFirst({ orderBy: { siteId: "desc" }, select: { siteId: true } }),
      ])
      const d = firstBc[0]?.d ?? null
      const before = d ? await prisma.archiveSale.findFirst({ where: { saleDate: { lt: new Date(d + "T00:00:00Z") } }, orderBy: { siteId: "desc" }, select: { siteId: true } }) : null
      if (before) collect.from = before.siteId
      if (newest) collect.to = newest.siteId + 300
      const bits = [
        d ? `The first Business Central sale was ${fmtDate(d)}` : null,
        before ? `which is about the website's sale ${before.siteId}` : null,
        newest ? `and the newest sale the Hub has ever seen on the site is ${newest.siteId}` : null,
      ].filter(Boolean)
      collect.basis = bits.length ? bits.join(", ") + "." : ""
    } catch { collect.basis = "" }
  }
  const link = (p: number) => {
    const u = new URLSearchParams(); if (q) u.set("q", q); if (year) u.set("year", year); if (sale) u.set("sale", sale)
    // ⚠ Carry the sort across pages too, or page 2 quietly reverts to newest-first.
    if (one(sp.min)) u.set("min", one(sp.min)); if (one(sp.max)) u.set("max", one(sp.max))
    if (order) u.set("order", order); u.set("page", String(p))
    return `/databases/bc?${u}`
  }
  const input = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 min-h-[44px] text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-violet-500"
  const pct = (x: number) => stats?.n ? Math.round((x / stats.n) * 100) : 0
  const tile = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] px-4 py-3"
  const big = "text-2xl font-bold text-gray-900 dark:text-white tabular-nums", lbl = "text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400", sub = "text-xs text-gray-500 dark:text-gray-400 mt-0.5"
  const code = "font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded"

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0D0D0F] text-gray-900 dark:text-gray-100">
      <div className="px-4 py-6 space-y-5">
        <div>
          <Link href="/databases" className="text-sm text-gray-500 hover:text-gray-300">← Databases</Link>
          <h1 className="text-xl font-bold mt-1">BC Database</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">Every lot sold through Business Central — sale, lot, estimate and hammer from the nightly BC sync, with the full description, photo and link matched from the website.</p>
        </div>

        {stats && stats.n > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className={tile}><div className={lbl}>Lots in the BC database</div><div className={big}>{stats.n.toLocaleString()}</div>
              <div className={sub}>{stats.sales.toLocaleString()} sales · {fmtDate(stats.from)} → {fmtDate(stats.to)}</div></div>
            <div className={tile}><div className={lbl}>Sold</div><div className={big}>{stats.sold.toLocaleString()}</div>
              <div className={sub}>hammer total {fmtGBP(stats.hammer)} · {(stats.n - stats.sold).toLocaleString()} unsold</div></div>
            <div className={tile}><div className={lbl}>Photos in the Hub</div><div className={big}>{stats.inHub.toLocaleString()} <span className="text-base font-semibold text-gray-500">({pct(stats.inHub)}%)</span></div>
              <div className={sub}>{stats.fullSize.toLocaleString()} full-size backups · {stats.siteOnly.toLocaleString()} still on the website only · {stats.noPhoto.toLocaleString()} not matched yet</div>
              <div className="mt-2 h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${pct(stats.inHub)}%` }} /></div></div>
            <div className={tile}><div className={lbl}>Full descriptions from the website</div><div className={big}>{stats.longDesc.toLocaleString()} <span className="text-base font-semibold text-gray-500">({pct(stats.longDesc)}%)</span></div>
              <div className={sub}>the rest show BC's short description until the pull reaches their sale</div></div>
          </div>
        )}

        {isAdmin && <ArchiveSite scope="bc" />}
        {isAdmin && <BcCollect defaultFrom={collect.from} defaultTo={collect.to} basis={collect.basis} />}
        {isAdmin && (
          <details className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] p-5">
            <summary className="cursor-pointer text-base font-bold text-gray-900 dark:text-white">Export &amp; handover — for a backup, or a future website</summary>
            <div className="mt-3 space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <div className="flex flex-wrap items-center gap-3">
                <a href="/api/databases/bc/export" className="min-h-[44px] inline-flex items-center px-4 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">⬇ Export data (CSV)</a>
                <span className="text-gray-600 dark:text-gray-400">Every lot, one row each: BC's figures, the website's full description, both photo file names and the site link. Streams as it goes.</span>
              </div>
              <p><span className="font-semibold text-gray-900 dark:text-white">Where the photos live.</span> Cloudflare R2, bucket <code className={code}>{process.env.CLOUDFLARE_R2_BUCKET ?? "(not set)"}</code>, two files per lot named by its BC unique ID:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><code className={code}>bc-photos/xl/&#123;UniqueID&#125;.webp</code> — full size (about 250 KB)</li>
                <li><code className={code}>bc-photos/&#123;UniqueID&#125;.webp</code> — small display copy (about 23 KB)</li>
              </ul>
              <p className="text-gray-600 dark:text-gray-400">Handover works exactly as on the ABC Database page: the CSV plus a read-only R2 token, copied bucket-to-bucket. The lot data itself lives in Business Central and is re-synced nightly.</p>
            </div>
          </details>
        )}

        {/* ⚠ One box on show, the rest behind More filters (Jordan's choice, 2026-09-09). The panel
            opens already open when any of those filters is in use, so a narrowed list never looks
            unfiltered. */}
        <form method="get" className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <input name="q" defaultValue={q} placeholder="Search descriptions — e.g. Corgi 267, Steiff, Star Wars" className={input} />
            <select name="order" defaultValue={order} className={input} aria-label="Order the results">
              <option value="">Newest sale first</option>
              <option value="oldest">Oldest sale first</option>
              <option value="price_desc">Hammer: high to low</option>
              <option value="price_asc">Hammer: low to high</option>
              <option value="lot">Sale then lot number</option>
            </select>
            <button type="submit" className="min-h-[44px] px-5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Search</button>
          </div>
          <details open={!!(sale || year || one(sp.min) || one(sp.max))} className="rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-2">
            <summary className="cursor-pointer text-sm text-gray-700 dark:text-gray-300">More filters</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-4">
              <input name="sale" defaultValue={sale} placeholder="Sale title" className={input} />
              <input name="year" defaultValue={year} placeholder="Year" inputMode="numeric" className={input} />
              <input name="min" defaultValue={one(sp.min)} placeholder="Min £" inputMode="numeric" className={input} />
              <input name="max" defaultValue={one(sp.max)} placeholder="Max £" inputMode="numeric" className={input} />
            </div>
          </details>
        </form>

        {tableError ? (
          <p className="rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">⚠ {tableError}</p>
        ) : stats && stats.n === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">Nothing here yet — the BC sync hasn't loaded any sold lots. Run Data Sync first.</p>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">{total.toLocaleString()} {total === 1 ? "lot" : "lots"}{(q || sale || year || one(sp.min) || one(sp.max)) ? " match" : ""} · page {page} of {pages}</p>
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-[#141416]">
                  <tr>
                    <th className="px-3 py-2"></th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Sale</th><th className="px-3 py-2 text-right">Lot</th>
                    <th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Estimate</th><th className="px-3 py-2 text-right">Hammer</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className={`border-t border-gray-100 dark:border-gray-800/70 align-top ${i % 2 ? "bg-white dark:bg-[#141416]/40" : ""}`}>
                      <td className="px-2 py-2 w-16">
                        {r.photo ? <a href={r.photoFull ?? r.photo} target="_blank" rel="noreferrer"><img src={r.photo} alt="" loading="lazy" className="h-14 w-14 object-cover rounded-md bg-gray-100 dark:bg-gray-800" /></a> : <div className="h-14 w-14 rounded-md bg-gray-100 dark:bg-gray-800/60" />}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{fmtDate(r.auctionDate)}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[220px]">{r.auctionName || `Sale ${r.auctionCode}`}<div className="text-xs text-gray-400">{r.auctionCode}</div></td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                        {r.lotNo ?? "—"}
                        <div className="text-xs text-gray-400 font-mono" title="BC's unique ID">{r.uniqueId}</div>
                        {r.siteLink && <a href={`https://www.vectis.co.uk/${r.siteLink}`} target="_blank" rel="noreferrer" className="block text-xs font-sans text-violet-600 dark:text-violet-400 hover:underline" title="Open this lot on vectis.co.uk">vectis.co.uk ↗</a>}
                      </td>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                        {r.longDesc || r.shortDesc}
                        {!r.longDesc && <span className="ml-2 text-xs text-gray-400" title="BC's short description — the full one appears once the website pull reaches this sale">short</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-600 dark:text-gray-400">{r.estimateLow == null && r.estimateHigh == null ? "—" : `${fmtGBP(r.estimateLow)} – ${fmtGBP(r.estimateHigh)}`}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                        {r.hammerPrice == null ? <span className="font-normal text-gray-400">unsold</span> : fmtGBP(r.hammerPrice)}
                        {r.siteHammerPrice != null && r.siteHammerPrice !== r.hammerPrice && <div className="text-xs font-normal text-amber-600 dark:text-amber-400" title="The website shows a different hammer price for this lot">site {fmtGBP(r.siteHammerPrice)}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center gap-2 text-sm">
                {page > 1 && <Link href={link(page - 1)} className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-violet-500">← Previous</Link>}
                <span className="text-gray-500">page {page} of {pages}</span>
                {page < pages && <Link href={link(page + 1)} className="min-h-[44px] inline-flex items-center px-4 rounded-lg border border-gray-300 dark:border-gray-700 hover:border-violet-500">Next →</Link>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
