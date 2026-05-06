import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCTokenAny, bcPage } from "@/lib/bc"

// GET /api/warehouse/sale-checklist
// Returns all auction codes with their items and locations from WarehouseItem DB.
// Auction names come from BC (Receipt_Lines_Excel) — not from local CatalogueAuction.

// Auction_Receipt_Lines_Excel field candidates for code and name
const ARL_CODE_CANDIDATES = ["EVA_ARL_AuctionCode", "EVA_SalesAllocation", "Auction_Code", "AuctionCode", "Sale_Code"]
const ARL_NAME_CANDIDATES = ["EVA_ARL_AuctionName", "EVA_AuctionName", "Auction_Name", "AuctionName", "Sale_Name",
                              "EVA_SalesAllocationDescription", "EVA_AuctionDescription"]

async function fetchBCAuctionNames(): Promise<Map<string, string>> {
  const nameByCode = new Map<string, string>()
  try {
    const token = await getBCTokenAny()
    if (!token) return nameByCode

    // Fetch a small sample from Auction_Receipt_Lines_Excel to discover field names
    const sample = await bcPage(token, "Auction_Receipt_Lines_Excel", { $top: 5 })
    if (!sample.length) return nameByCode

    const firstRow = sample[0]
    const codeField = ARL_CODE_CANDIDATES.find(f => f in firstRow)
    const nameField = ARL_NAME_CANDIDATES.find(f => f in firstRow && firstRow[f])

    if (!codeField || !nameField) return nameByCode

    // Fetch a broad sample — one row per distinct code is all we need,
    // but OData has no DISTINCT so we take 2000 and deduplicate in JS
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
    // BC unavailable — fall back to code-only names silently
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
