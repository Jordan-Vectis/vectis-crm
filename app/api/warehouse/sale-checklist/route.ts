import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCTokenAny, bcPage } from "@/lib/bc"

// GET /api/warehouse/sale-checklist
// BC-data only. Items come from WarehouseItem (synced from BC).
// Auction names stored in WarehouseItem.auctionName. Any missing names are
// fetched live from Auction_Lines_Excel via EVA_UniqueID → EVA_AuctionName
// and written back to the DB so they're cached for next time.

async function fetchAndCacheAuctionNames(
  codeToUniqueId: Map<string, string>,
): Promise<Map<string, string>> {
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

    // Write discovered names back to DB for all items with that auction code
    if (nameByCode.size > 0) {
      const updates: Promise<any>[] = []
      for (const [code, name] of nameByCode) {
        updates.push(
          prisma.warehouseItem.updateMany({
            where: { auctionCode: code, auctionName: null },
            data:  { auctionName: name },
          }),
        )
      }
      await Promise.all(updates)
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
      auctionName:  true,
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

  // Find codes that have no stored name — need a BC lookup
  const codeToUniqueId = new Map<string, string>()
  for (const item of rows) {
    const code = item.auctionCode!
    if (!item.auctionName && !codeToUniqueId.has(code)) {
      codeToUniqueId.set(code, item.uniqueId)
    }
  }

  // Fetch missing names from BC and cache them in DB
  const fetchedNames = await fetchAndCacheAuctionNames(codeToUniqueId)

  // Group by auction code
  const auctionMap = new Map<
    string,
    { code: string; name: string | null; date: string | null; items: typeof rows }
  >()
  for (const item of rows) {
    const code = item.auctionCode!
    if (!auctionMap.has(code)) {
      const name =
        item.auctionName ??
        fetchedNames.get(code.trim().toUpperCase()) ??
        null
      auctionMap.set(code, {
        code,
        name,
        date: item.auctionDate ?? null,
        items: [],
      })
    }
    auctionMap.get(code)!.items.push(item)
  }

  const auctions = [...auctionMap.values()].sort(
    (a, b) => (b.date ?? "").localeCompare(a.date ?? ""),
  )

  return NextResponse.json({ auctions, total: rows.length })
}
