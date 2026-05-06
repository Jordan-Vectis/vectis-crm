import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCTokenAny, bcPage } from "@/lib/bc"

// GET /api/warehouse/sale-checklist
// BC-data only. Items come from WarehouseItem (synced from BC).
// Auction names resolved from Auction_Lines_Excel via EVA_UniqueID → EVA_AuctionName.
// CatalogueAuction is intentionally not used here.

// codeToUniqueId: one representative uniqueId per auction code from our DB.
// We filter Auction_Lines_Excel by those UniqueIDs to get EVA_AuctionName.
async function fetchBCAuctionNames(codeToUniqueId: Map<string, string>): Promise<Map<string, string>> {
  const nameByCode = new Map<string, string>()
  if (codeToUniqueId.size === 0) return nameByCode
  try {
    const token = await getBCTokenAny()
    if (!token) return nameByCode

    const entries = [...codeToUniqueId.entries()]
    const BATCH = 30
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH)
      const filter = batch.map(([, id]) => `EVA_UniqueID eq '${id}'`).join(" or ")
      const rows = await bcPage(token, "Auction_Lines_Excel", {
        $filter: filter,
        $top: batch.length + 5,
      })
      for (const r of rows) {
        const uid  = String(r.EVA_UniqueID    ?? "").trim()
        const name = String(r.EVA_AuctionName ?? "").trim()
        if (!uid || !name) continue
        const code = batch.find(([, id]) => id === uid)?.[0]
        if (code) nameByCode.set(code.toUpperCase(), name)
      }
    }
  } catch {
    // BC unavailable — names will be null, codes still show
  }
  return nameByCode
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const rows = await prisma.warehouseItem.findMany({
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
  })

  // Build one representative uniqueId per auction code
  const codeToUniqueId = new Map<string, string>()
  for (const item of rows) {
    if (!codeToUniqueId.has(item.auctionCode!)) {
      codeToUniqueId.set(item.auctionCode!, item.uniqueId)
    }
  }

  const nameByCode = await fetchBCAuctionNames(codeToUniqueId)

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
