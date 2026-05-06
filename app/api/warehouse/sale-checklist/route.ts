import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getBCTokenAny, bcPage } from "@/lib/bc"

// GET /api/warehouse/sale-checklist
// Returns all auction codes with their items and locations from WarehouseItem DB.
// Auction names come from BC (Receipt_Lines_Excel) — not from local CatalogueAuction.

const ARL_CODE_CANDIDATES = ["EVA_ARL_AuctionCode", "EVA_SalesAllocation", "Auction_Code", "AuctionCode", "Sale_Code"]
const ARL_NAME_CANDIDATES = [
  "EVA_ARL_AuctionName", "EVA_ARL_AuctionDescription", "EVA_ARL_SaleDescription",
  "EVA_AuctionName", "EVA_AuctionDescription", "EVA_SalesAllocationDescription",
  "Auction_Name", "AuctionName", "Sale_Name", "SaleName", "Description",
]
// Keywords that hint a field is a human-readable name/description (not a code or date)
const NAME_HINT = /name|description|desc|title/i

async function tryEndpointForNames(
  token: string,
  endpoint: string,
  codeCandidates: string[],
): Promise<Map<string, string>> {
  const nameByCode = new Map<string, string>()
  const sample = await bcPage(token, endpoint, { $top: 5 })
  if (!sample.length) return nameByCode

  const firstRow = sample[0]
  const codeField = codeCandidates.find(f => f in firstRow)
  if (!codeField) return nameByCode

  // 1. Try known candidates first
  let nameField = ARL_NAME_CANDIDATES.find(f => f in firstRow && firstRow[f])
  // 2. Fall back: scan all string fields whose name hints at a description
  if (!nameField) {
    nameField = Object.keys(firstRow).find(
      f => f !== codeField && NAME_HINT.test(f) && typeof firstRow[f] === "string" && firstRow[f],
    )
  }
  if (!nameField) return nameByCode

  const rows = await bcPage(token, endpoint, {
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
  return nameByCode
}

async function fetchBCAuctionNames(): Promise<Map<string, string>> {
  try {
    const token = await getBCTokenAny()
    if (!token) return new Map()

    // Try Auction_Receipt_Lines_Excel first (EVA_ARL_* fields), then Receipt_Lines_Excel
    for (const endpoint of ["Auction_Receipt_Lines_Excel", "Receipt_Lines_Excel"]) {
      const map = await tryEndpointForNames(token, endpoint, ARL_CODE_CANDIDATES)
      if (map.size > 0) return map
    }
  } catch {
    // BC unavailable — caller will fall back to local table
  }
  return new Map()
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const [rows, bcNames, catalogueAuctions] = await Promise.all([
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
    prisma.catalogueAuction.findMany({ select: { code: true, name: true } }),
  ])

  // BC names take priority; local CatalogueAuction is a fallback so names always show
  const nameByCode = new Map<string, string>()
  for (const a of catalogueAuctions) nameByCode.set(a.code.trim().toUpperCase(), a.name)
  for (const [k, v] of bcNames)       nameByCode.set(k, v) // BC overwrites local

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
