import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/search?location=A2A1&mode=exact   → exact match (default)
// GET /api/warehouse/search?location=A2&mode=aisle     → whole-aisle match
//
// Aisle logic: "A2" must match A2A1, A2B3 etc. but NOT A20C3, A22M5.
// Location format is <aisle><bay><shelf> e.g. A2A1 → aisle=A2, bay=A, shelf=1.
// After the aisle prefix the next character is always a letter (the bay).
// We fetch startsWith from the DB (fast, uses index) then filter in JS.
function isExactAisle(location: string | null, aisle: string): boolean {
  if (!location) return false
  const loc  = location.toUpperCase()
  const q    = aisle.toUpperCase()
  if (!loc.startsWith(q)) return false
  // The character immediately after the aisle prefix must be a letter (bay)
  const next = loc[q.length]
  return next !== undefined && /[A-Z]/.test(next)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const q    = req.nextUrl.searchParams.get("location")?.trim().toUpperCase() ?? ""
  const mode = req.nextUrl.searchParams.get("mode") ?? "exact"  // "exact" | "aisle"
  if (!q) return NextResponse.json({ items: [], totes: [] })

  const locationWhere = mode === "aisle"
    ? { startsWith: q, mode: "insensitive" as const }  // broad — filtered in JS below
    : { equals:     q, mode: "insensitive" as const }

  // For aisle mode fetch more rows (startsWith is a superset) then filter in JS
  const dbTake = mode === "aisle" ? 5000 : 500

  const [rawItems, rawTotes] = await Promise.all([
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
      take: dbTake,
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
      take: dbTake,
    }),
  ])

  const items = mode === "aisle"
    ? rawItems.filter(i => isExactAisle(i.location, q)).slice(0, 500)
    : rawItems

  const totes = mode === "aisle"
    ? rawTotes.filter(t => isExactAisle(t.location, q)).slice(0, 500)
    : rawTotes

  return NextResponse.json({ items, totes, total: items.length + totes.length })
}
