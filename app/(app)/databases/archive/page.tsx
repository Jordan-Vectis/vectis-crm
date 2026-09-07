import Link from "next/link"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import ArchiveImport from "./archive-import"
import ArchiveSite from "./archive-site"
import { getSignedImageUrl } from "@/lib/r2"
import { SITE_IMAGES } from "@/lib/archive-site"

// Databases → Lot Archive: the pre-BC lot history (1999 → the BC switch), searchable.
// Photos: our R2 copy when the photo job has run, else the site's own picture.
// Server-rendered from query params so a twenty-year table is never sent to the
// browser — 100 rows a page. Admins get the import panel on top.
const PAGE = 100
const fmtDate = (d: Date | null) => d ? d.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : "—"
const fmtGBP = (n: number | null) => n == null ? "—" : "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 0 })

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ""

export default async function ArchivePage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await auth()
  const isAdmin = session?.user?.role === "ADMIN"
  const sp = await searchParams
  const q = one(sp.q).trim(), year = one(sp.year).trim(), sale = one(sp.sale).trim()
  const min = parseFloat(one(sp.min)), max = parseFloat(one(sp.max))
  const page = Math.max(1, parseInt(one(sp.page)) || 1)

  const where: any = {}
  const and: any[] = []
  if (q) and.push({ OR: [{ description: { contains: q, mode: "insensitive" } }, { saleTitle: { contains: q, mode: "insensitive" } }] })
  if (sale) and.push({ saleTitle: { contains: sale, mode: "insensitive" } })
  if (/^\d{4}$/.test(year)) and.push({ auctionDate: { gte: new Date(Date.UTC(+year, 0, 1)), lt: new Date(Date.UTC(+year + 1, 0, 1)) } })
  if (Number.isFinite(min)) and.push({ hammerPrice: { gte: min } })
  if (Number.isFinite(max)) and.push({ hammerPrice: { lte: max } })
  if (and.length) where.AND = and

  // Migration-safe: before Run Migrations the table isn't there — say so, don't 500.
  type Stats = { n: number; sales: number; from: Date | null; to: Date | null; hammer: number; sold: number; withLotId: number; inHub: number; siteOnly: number; noPhoto: number; fromSheet: number; fromSite: number }
  let rows: any[] = [], total = 0, stats: Stats | null = null, tableError: string | null = null
  try {
    const [r, t, agg] = await Promise.all([
      prisma.archiveLot.findMany({ where, orderBy: [{ auctionDate: "desc" }, { auctionId: "desc" }, { lot: "asc" }], skip: (page - 1) * PAGE, take: PAGE }),
      prisma.archiveLot.count({ where }),
      // One pass over the table for the summary box (a million rows — one scan, not eight counts).
      prisma.$queryRaw<{ n: bigint; sales: bigint; from: Date | null; to: Date | null; hammer: number | null; sold: bigint; withlotid: bigint; inhub: bigint; siteonly: bigint; fromsheet: bigint }[]>`
        SELECT count(*)::bigint AS n, count(DISTINCT "auctionId")::bigint AS sales, min("auctionDate") AS "from", max("auctionDate") AS "to",
               sum("hammerPrice")::float8 AS hammer, count("hammerPrice")::bigint AS sold, count("lotId")::bigint AS withlotid,
               count("photoKey")::bigint AS inhub,
               count(*) FILTER (WHERE "photoKey" IS NULL AND "sitePhoto" IS NOT NULL)::bigint AS siteonly,
               count(*) FILTER (WHERE "source" = 'sheet')::bigint AS fromsheet
        FROM "ArchiveLot"`,
    ])
    rows = r; total = t
    const a = agg[0]
    const n = Number(a?.n ?? 0), inHub = Number(a?.inhub ?? 0), siteOnly = Number(a?.siteonly ?? 0)
    stats = {
      n, sales: Number(a?.sales ?? 0), from: a?.from ?? null, to: a?.to ?? null, hammer: a?.hammer ?? 0, sold: Number(a?.sold ?? 0),
      withLotId: Number(a?.withlotid ?? 0), inHub, siteOnly, noPhoto: n - inHub - siteOnly, fromSheet: Number(a?.fromsheet ?? 0), fromSite: n - Number(a?.fromsheet ?? 0),
    }
    // A picture per row: our copy (signed) first, else the site's medium-size image.
    await Promise.all(rows.map(async row => {
      row.photo = row.photoKey ? await getSignedImageUrl(row.photoKey, 3600).catch(() => null)
        : row.sitePhoto ? SITE_IMAGES + String(row.sitePhoto).replace("/large/", "/medium/") : null
    }))
  } catch (e: any) {
    tableError = /does not exist|relation/i.test(String(e?.message)) ? "The archive table isn't there yet — Run Migrations on this environment first." : (e?.message ?? "Couldn't read the archive")
  }
  const pages = Math.max(1, Math.ceil(total / PAGE))
  const link = (p: number) => {
    const u = new URLSearchParams(); if (q) u.set("q", q); if (year) u.set("year", year); if (sale) u.set("sale", sale)
    if (one(sp.min)) u.set("min", one(sp.min)); if (one(sp.max)) u.set("max", one(sp.max)); u.set("page", String(p))
    return `/databases/archive?${u}`
  }
  const input = "rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#1C1C1E] px-3 min-h-[44px] text-base text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-violet-500"

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0D0D0F] text-gray-900 dark:text-gray-100">
      <div className="px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/databases" className="text-sm text-gray-500 hover:text-gray-300">← Databases</Link>
            <h1 className="text-xl font-bold mt-1">Lot Archive</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">Every lot sold before Business Central — descriptions, estimates and hammer prices from the old system's export, with LotIDs and photos matched from the website.</p>
          </div>
        </div>

        {stats && stats.n > 0 && (() => {
          const pct = (x: number) => stats!.n ? Math.round((x / stats!.n) * 100) : 0
          const tile = "rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#141416] px-4 py-3"
          const big = "text-2xl font-bold text-gray-900 dark:text-white tabular-nums"
          const lbl = "text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400"
          const sub = "text-xs text-gray-500 dark:text-gray-400 mt-0.5"
          return (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className={tile}><div className={lbl}>Lots in the archive</div><div className={big}>{stats.n.toLocaleString()}</div>
                <div className={sub}>{stats.sales.toLocaleString()} sales · {fmtDate(stats.from)} → {fmtDate(stats.to)}</div></div>
              <div className={tile}><div className={lbl}>Sold</div><div className={big}>{stats.sold.toLocaleString()}</div>
                <div className={sub}>hammer total {fmtGBP(stats.hammer)} · {(stats.n - stats.sold).toLocaleString()} unsold or no result</div></div>
              <div className={tile}><div className={lbl}>Photos in the Hub</div><div className={big}>{stats.inHub.toLocaleString()} <span className="text-base font-semibold text-gray-500">({pct(stats.inHub)}%)</span></div>
                <div className={sub}>{stats.siteOnly.toLocaleString()} still on the website only · {stats.noPhoto.toLocaleString()} no photo</div>
                <div className="mt-2 h-1.5 rounded bg-gray-200 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500" style={{ width: `${pct(stats.inHub)}%` }} /></div></div>
              <div className={tile}><div className={lbl}>Where the lots came from</div><div className={big}>{stats.fromSheet.toLocaleString()}</div>
                <div className={sub}>from the old system's export · {stats.fromSite.toLocaleString()} from the website · {stats.withLotId.toLocaleString()} with a LotID</div></div>
            </div>
          )
        })()}

        {isAdmin && <ArchiveImport />}
        {isAdmin && <ArchiveSite />}

        <form method="get" className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]">
          <input name="q" defaultValue={q} placeholder="Search descriptions — e.g. Dinky 105, Steiff, Palitoy Leia" className={input} />
          <input name="sale" defaultValue={sale} placeholder="Sale title" className={input} />
          <input name="year" defaultValue={year} placeholder="Year" inputMode="numeric" className={input} />
          <input name="min" defaultValue={one(sp.min)} placeholder="Min £" inputMode="numeric" className={input} />
          <input name="max" defaultValue={one(sp.max)} placeholder="Max £" inputMode="numeric" className={input} />
          <button type="submit" className="min-h-[44px] px-5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-semibold">Search</button>
        </form>

        {tableError ? (
          <p className="rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">⚠ {tableError}</p>
        ) : stats && stats.n === 0 ? (
          <p className="text-sm text-gray-600 dark:text-gray-400">The archive is empty. {isAdmin ? "Import the spreadsheet or pull from the website above to fill it." : "An admin needs to fill it first."}</p>
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
                        {r.photo ? <a href={r.photo} target="_blank" rel="noreferrer"><img src={r.photo} alt="" loading="lazy" className="h-14 w-14 object-cover rounded-md bg-gray-100 dark:bg-gray-800" /></a> : <div className="h-14 w-14 rounded-md bg-gray-100 dark:bg-gray-800/60" />}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-400">{fmtDate(r.auctionDate)}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-gray-300 max-w-[220px]">{r.saleTitle || `Sale ${r.auctionId}`}<div className="text-xs text-gray-400">sale {r.auctionId}</div></td>
                      <td className="px-3 py-2 text-right font-mono">{r.lot}{r.lotId && <div className="text-xs text-gray-400 font-mono" title="The old system's LotID">{r.lotId}</div>}</td>
                      <td className="px-3 py-2 text-gray-900 dark:text-gray-100">{r.description}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-600 dark:text-gray-400">{r.estimateLow == null && r.estimateHigh == null ? "—" : `${fmtGBP(r.estimateLow)} – ${fmtGBP(r.estimateHigh)}`}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                        {fmtGBP(r.hammerPrice)}
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
