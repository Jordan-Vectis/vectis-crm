import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/sale-checklist
// Returns all auction codes with their items and locations from WarehouseItem DB,
// plus the human-readable auction name from CatalogueAuction (matched by code).
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const [rows, catalogueAuctions] = await Promise.all([
    prisma.warehouseItem.findMany({
      where: { auctionCode: { not: null } },
      select: {
        uniqueId:     true,
        barcode:      true,
        auctionCode:  true,
        auctionDate:  true,
        lotNo:        true,
        currentLotNo: true,
        description:  true,
        artist:       true,
        location:     true,
        binCode:      true,
        toteNo:       true,
        vendorNo:     true,
        vendorName:   true,
        withdrawLot:  true,
        collected:    true,
      },
      orderBy: [{ auctionCode: "asc" }, { currentLotNo: "asc" }],
    }),
    prisma.catalogueAuction.findMany({
      select: { code: true, name: true },
    }),
  ])

  // Code → auction name lookup (case-insensitive)
  const nameByCode = new Map<string, string>()
  for (const a of catalogueAuctions) {
    nameByCode.set(a.code.trim().toUpperCase(), a.name)
  }

  // Group by auction code
  const auctionMap = new Map<string, { code: string; name: string | null; date: string | null; items: typeof rows }>()

  for (const item of rows) {
    const code = item.auctionCode!
    if (!auctionMap.has(code)) {
      auctionMap.set(code, {
        code,
        name: nameByCode.get(code.trim().toUpperCase()) ?? null,
        date: item.auctionDate ?? null,
        items: [],
      })
    }
    auctionMap.get(code)!.items.push(item)
  }

  const auctions = [...auctionMap.values()]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))

  return NextResponse.json({ auctions, total: rows.length })
}
