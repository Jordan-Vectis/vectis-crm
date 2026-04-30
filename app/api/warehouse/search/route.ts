import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/search?location=A21
// Returns all WarehouseItems whose location contains the query string.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const q = req.nextUrl.searchParams.get("location")?.trim() ?? ""
  if (!q) return NextResponse.json({ items: [] })

  const items = await prisma.warehouseItem.findMany({
    where: { location: { contains: q, mode: "insensitive" } },
    select: {
      uniqueId:     true,
      location:     true,
      binCode:      true,
      toteNo:       true,
      barcode:      true,
      description:  true,
      artist:       true,
      category:     true,
      catalogued:   true,
      auctionCode:  true,
      lotNo:        true,
      currentLotNo: true,
      locationScannedAt: true,
    },
    orderBy: { location: "asc" },
    take: 500,
  })

  return NextResponse.json({ items, total: items.length })
}
