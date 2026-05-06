import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCTokenAny, bcPage } from "@/lib/bc"

// GET /api/warehouse/sale-checklist
// BC-data only. Items come from WarehouseItem (synced from BC).
// Auction names are resolved live from Auction_Receipt_Lines_Excel.
// CatalogueAuction (the app's cataloguing system) is intentionally not used here.

const ARL_CODE_CANDIDATES = ["EVA_ARL_AuctionCode", "EVA_SalesAllocation", "Auction_Code", "AuctionCode"]
const ARL_NAME_CANDIDATES = [
  "EVA_ARL_AuctionName", "EVA_ARL_AuctionDescription", "EVA_ARL_SaleDescription",
  "EVA_AuctionName", "EVA_AuctionDescription", "EVA_SalesAllocationDescription",
  "Auction_Name", "AuctionName", "Sale_Name",
]

async function fetchBCAuctionNames(): Promise<Map<string, string>> {
  const nameByCode = new Map<string, string>()
  try {
    const token = await getBCTokenAny()
    if (!token) return nameByCode

    // Sample a few rows to discover which fields hold the code and name
    const sample = await bcPage(token, "Auction_Receipt_Lines_Excel", { $top: 5 })
    if (!sample.length) return nameByCode

    const firstRow = sample[0]
    const codeField = ARL_CODE_CANDIDATES.find(f => f in firstRow)
    const nameField = ARL_NAME_CANDIDATES.find(f => f in firstRow && firstRow[f])
    if (!codeField || !nameField) return nameByCode

    // Fetch a broad sample and deduplicate by code
    const rows = await bcPage(token, "Auction_Receipt_Lines_Excel", {
      $top:    2000,
      $select: `${codeField},${nameField}`,
      $orderby: `${codeField} asc`,
    })

    for (const r of rows) {
      const code = String(r[codeField] ?? "").trim()
      const name = String(r[nameField] ?? "").trim()
      if (code && name && !nameByCode.has(code.toUpperCase())) {
        nameByCode.set(code.toUpperCase(), name)
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
