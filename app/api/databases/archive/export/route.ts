import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { SITE_IMAGES } from "@/lib/archive-site"

// Databases → Lot Archive → ⬇ Export data: the whole archive as one CSV, STREAMED in
// batches of 5,000 rows so a million-row table never sits in memory. Every column a
// future website would need, with the LotID and both photo file names on each row.
// Admin only — this is the entire pre-BC history in one file.
export const dynamic = "force-dynamic"

const COLS = ["AuctionID", "AuctionDate", "OnlineTitle", "Lot", "LotID", "Description", "BottomPrice", "TopPrice", "HammerPrice", "SiteHammerPrice", "SiteLotId", "SiteLink", "PhotoFile", "PhotoFullSizeFile", "SitePhotoUrl", "Source"]
const cell = (v: unknown): string => {
  if (v == null) return ""
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

  const enc = new TextEncoder()
  let cursor: string | null = null, done = false
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(enc.encode("﻿" + COLS.join(",") + "\r\n")) },
    async pull(c) {
      if (done) { c.close(); return }
      const rows = await prisma.archiveLot.findMany({
        take: 5000, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}), orderBy: { id: "asc" },
        select: { id: true, auctionId: true, auctionDate: true, saleTitle: true, lot: true, lotId: true, description: true, estimateLow: true, estimateHigh: true, hammerPrice: true, siteHammerPrice: true, siteLotId: true, siteLink: true, photoKey: true, photoXlKey: true, sitePhoto: true, source: true },
      })
      if (!rows.length) { done = true; c.close(); return }
      cursor = rows[rows.length - 1].id
      let out = ""
      for (const r of rows) {
        out += [
          r.auctionId, r.auctionDate, r.saleTitle, r.lot, r.lotId, r.description, r.estimateLow, r.estimateHigh, r.hammerPrice, r.siteHammerPrice,
          r.siteLotId, r.siteLink ? "https://www.vectis.co.uk/" + r.siteLink : "", r.photoKey, r.photoXlKey, r.sitePhoto ? SITE_IMAGES + r.sitePhoto : "", r.source,
        ].map(cell).join(",") + "\r\n"
      }
      c.enqueue(enc.encode(out))
      if (rows.length < 5000) done = true
    },
  })
  const name = `Lot Archive ${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } })
}
