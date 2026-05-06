import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCTokenAny, bcPage } from "@/lib/bc"

// GET /api/warehouse/sale-checklist
// BC-data only. Items come from WarehouseItem (synced from BC).
// Auction names are resolved live from Auction_Receipt_Lines_Excel.
// CatalogueAuction (the app's cataloguing system) is intentionally not used here.


async function fetchBCAuctionNames(): Promise<Map<string, string>> {
  const nameByCode = new Map<string, string>()
  try {
    const token = await getBCTokenAny()
    if (!token) return nameByCode

    // Fetch all fields so we can detect the correct code field name
    const sample = await bcPage(token, "Auction_Lines_Excel", { $top: 10 })
    if (!sample.length) return nameByCode

    // EVA_AuctionName confirmed by user. Find the field that holds the F-code
    // (e.g. F069) — try known candidates against actual field names in response.
    const CODE_CANDIDATES = ["EVA_SalesAllocation", "EVA_ARL_AuctionCode", "EVA_AuctionCode",
                             "EVA_SaleCode", "EVA_Sale_Code", "Sale_Code", "AuctionCode"]
    const firstRow = sample[0]
    const codeField = CODE_CANDIDATES.find(f => f in firstRow)

    if (!codeField || !("EVA_AuctionName" in firstRow)) return nameByCode

    for (const r of sample) {
      const code = String(r[codeField]      ?? "").trim()
      const name = String(r.EVA_AuctionName ?? "").trim()
      if (code && name && !nameByCode.has(code.toUpperCase())) {
        nameByCode.set(code.toUpperCase(), name)
      }
    }

    // If sample wasn't enough, fetch more
    if (nameByCode.size < 5) {
      const rows = await bcPage(token, "Auction_Lines_Excel", { $top: 2000 })
      for (const r of rows) {
        const code = String(r[codeField]      ?? "").trim()
        const name = String(r.EVA_AuctionName ?? "").trim()
        if (code && name && !nameByCode.has(code.toUpperCase())) {
          nameByCode.set(code.toUpperCase(), name)
        }
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

  const [rows, nameByCode] = await Promise.all([
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
    fetchBCAuctionNames(),
  ])

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
