import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { SITE_IMAGES } from "@/lib/archive-site"

// Databases → BC Database → ⬇ Export data: every BC lot that has been through a sale,
// streamed 5,000 rows a batch — BC's figures plus the website's full description,
// link and photo file names. Admin only.
export const dynamic = "force-dynamic"

const COLS = ["UniqueID", "AuctionCode", "AuctionDate", "AuctionName", "Lot", "ShortDescription", "FullDescription", "LowEstimate", "HighEstimate", "HammerPrice", "SiteHammerPrice", "Category", "SiteLink", "PhotoFile", "PhotoFullSizeFile", "SitePhotoUrl"]
const cell = (v: unknown): string => {
  if (v == null) return ""
  const s = String(v)
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
type R = { id: string; uniqueId: string; auctionCode: string | null; auctionDate: string | null; auctionName: string | null; lotNo: number | null; shortDesc: string | null; longDesc: string | null; lowEstimate: number | null; highEstimate: number | null; hammerPrice: number | null; siteHammerPrice: number | null; category: string | null; siteLink: string | null; photoKey: string | null; photoXlKey: string | null; sitePhoto: string | null }

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  if (session.user?.role !== "ADMIN") return NextResponse.json({ error: "Admins only" }, { status: 403 })

  const enc = new TextEncoder()
  let cursor = "", done = false
  const stream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(enc.encode("﻿" + COLS.join(",") + "\r\n")) },
    async pull(c) {
      if (done) { c.close(); return }
      const rows = await prisma.$queryRaw<R[]>`
        SELECT w."id", w."uniqueId", w."auctionCode", w."auctionDate", w."auctionName",
               NULLIF(regexp_replace(COALESCE(NULLIF(w."currentLotNo", '0'), w."lotNo"), '[^0-9]', '', 'g'), '')::int AS "lotNo",
               w."description" AS "shortDesc", b."description" AS "longDesc", w."lowEstimate", w."highEstimate", NULLIF(w."hammerPrice", 0) AS "hammerPrice",
               b."siteHammerPrice", w."category", b."siteLink", b."photoKey", b."photoXlKey", b."sitePhoto"
        FROM "WarehouseItem" w LEFT JOIN "BcLotWeb" b ON b."uniqueId" = upper(w."uniqueId")
        WHERE w."auctionCode" IS NOT NULL AND w."auctionDate" IS NOT NULL AND w."auctionDate" <= to_char(now(), 'YYYY-MM-DD')
          AND COALESCE(NULLIF(w."currentLotNo", '0'), NULLIF(w."lotNo", '0')) IS NOT NULL AND w."id" > ${cursor}
        ORDER BY w."id" ASC LIMIT 5000`
      if (!rows.length) { done = true; c.close(); return }
      cursor = rows[rows.length - 1].id
      let out = ""
      for (const r of rows) {
        out += [r.uniqueId, r.auctionCode, r.auctionDate, r.auctionName, r.lotNo, r.shortDesc, r.longDesc, r.lowEstimate, r.highEstimate, r.hammerPrice, r.siteHammerPrice, r.category,
          r.siteLink ? "https://www.vectis.co.uk/" + r.siteLink : "", r.photoKey, r.photoXlKey, r.sitePhoto ? SITE_IMAGES + r.sitePhoto : ""].map(cell).join(",") + "\r\n"
      }
      c.enqueue(enc.encode(out))
      if (rows.length < 5000) done = true
    },
  })
  const name = `BC Database ${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } })
}
