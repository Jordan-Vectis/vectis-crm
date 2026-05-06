import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/search?location=A2A1&mode=exact   → exact match (default)
// GET /api/warehouse/search?location=A2&mode=aisle     → startsWith match (all shelves in aisle)
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const q    = req.nextUrl.searchParams.get("location")?.trim().toUpperCase() ?? ""
  const mode = req.nextUrl.searchParams.get("mode") ?? "exact"  // "exact" | "aisle"
  if (!q) return NextResponse.json({ items: [], totes: [] })

  const locationWhere = mode === "aisle"
    ? { startsWith: q, mode: "insensitive" as const }
    : { equals: q,     mode: "insensitive" as const }

  const [items, totes] = await Promise.all([
    prisma.warehouseItem.findMany({
      where: { location: locationWhere },
      select: {
        uniqueId:          true,
        location:          true,
        binCode:           true,
        toteNo:            true,
        barcode:           true,
        description:       true,
        artist:            true,
        category:          true,
        catalogued:        true,
        auctionCode:       true,
        lotNo:             true,
        currentLotNo:      true,
        locationScannedAt: true,
      },
      orderBy: { location: "asc" },
      take: 500,
    }),
    prisma.warehouseTote.findMany({
      where: { location: locationWhere },
      select: {
        toteNo:     true,
        location:   true,
        receiptNo:  true,
        vendorNo:   true,
        vendorName: true,
        status:     true,
        catalogued: true,
        syncedAt:   true,
      },
      orderBy: { toteNo: "asc" },
      take: 500,
    }),
  ])

  return NextResponse.json({ items, totes, total: items.length + totes.length })
}
