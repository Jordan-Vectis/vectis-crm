import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import LOCATIONS from "@/lib/warehouse-locations.json"
import { Prisma } from "@prisma/client"

// GET /api/warehouse/heatmap
// Supports optional query params:
//   filter  = all | active | catalogued_located | barcodes | totes_only
//   auction = <auction code>  (narrows items to that auction; hides totes)
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const params  = req.nextUrl.searchParams
  const filter  = params.get("filter")  ?? "all"
  const auction = params.get("auction") ?? ""

  // ── Item filter predicate ───────────────────────────────────────────────────
  const itemFilter: Prisma.WarehouseItemWhereInput = {}
  if (filter === "active")             itemFilter.catalogued = { not: true }
  if (filter === "catalogued_located") itemFilter.catalogued = true
  if (filter === "barcodes")           itemFilter.barcode    = { not: null }
  if (auction)                         itemFilter.auctionCode = auction

  const itemLocatedWhere: Prisma.WarehouseItemWhereInput = {
    ...itemFilter,
    location: { not: null, notIn: ["", " "] },
  }

  // ── Tote filter predicate ───────────────────────────────────────────────────
  // Totes excluded when: barcodes filter (totes have no barcode),
  //                      totes_only mode still shows totes,
  //                      auction filter (totes have no auction code).
  const showItems = filter !== "totes_only"
  const showTotes = filter !== "barcodes" && !auction

  const toteFilter: Prisma.WarehouseToteWhereInput = {}
  if (filter === "active")             toteFilter.catalogued = { not: true }
  if (filter === "catalogued_located") toteFilter.catalogued = true

  const toteLocatedWhere: Prisma.WarehouseToteWhereInput = {
    ...toteFilter,
    location: { not: null, notIn: ["", " "] },
  }

  const [groupedItems, groupedTotes, unlocatedItems, unlocatedTotes, totalItems, totalTotes, auctionRows] =
    await Promise.all([
      showItems
        ? prisma.warehouseItem.groupBy({
            by:    ["location"],
            where: itemLocatedWhere,
            _count: { _all: true },
          })
        : Promise.resolve([]),

      showTotes
        ? prisma.warehouseTote.groupBy({
            by:    ["location"],
            where: toteLocatedWhere,
            _count: { _all: true },
          })
        : Promise.resolve([]),

      // Unlocated counts (respect item filter, not location-locked)
      showItems
        ? prisma.warehouseItem.count({
            where: { ...itemFilter, OR: [{ location: null }, { location: "" }] },
          })
        : Promise.resolve(0),

      showTotes
        ? prisma.warehouseTote.count({
            where: { ...toteFilter, OR: [{ location: null }, { location: "" }] },
          })
        : Promise.resolve(0),

      showItems ? prisma.warehouseItem.count({ where: itemFilter }) : Promise.resolve(0),
      showTotes ? prisma.warehouseTote.count({ where: toteFilter }) : Promise.resolve(0),

      // Distinct auction codes for the filter dropdown
      prisma.warehouseItem.findMany({
        where:    { auctionCode: { not: null } },
        select:   { auctionCode: true },
        distinct: ["auctionCode"],
        orderBy:  { auctionCode: "asc" },
      }),
    ])

  // ── Build per-location maps ─────────────────────────────────────────────────
  const itemCounts = new Map<string, number>()
  for (const g of groupedItems) {
    const code = (g.location ?? "").trim().toUpperCase()
    if (!code) continue
    itemCounts.set(code, (itemCounts.get(code) ?? 0) + g._count._all)
  }
  const toteCounts = new Map<string, number>()
  for (const g of groupedTotes) {
    const code = (g.location ?? "").trim().toUpperCase()
    if (!code) continue
    toteCounts.set(code, (toteCounts.get(code) ?? 0) + g._count._all)
  }

  const known      = LOCATIONS as { code: string; name: string; cataloguingBench?: boolean }[]
  const knownCodes = new Set(known.map(l => l.code.toUpperCase()))

  const locations = known.map(l => {
    const k     = l.code.toUpperCase()
    const items = itemCounts.get(k) ?? 0
    const totes = toteCounts.get(k) ?? 0
    return {
      code:  l.code,
      name:  l.name,
      items,
      totes,
      total: items + totes,
      known: true,
      cataloguingBench: l.cataloguingBench ?? false,
    }
  })

  // Unknown locations
  const unknownLocs: typeof locations = []
  const seenUnknown = new Set<string>()
  function addUnknown(code: string) {
    if (knownCodes.has(code) || seenUnknown.has(code)) return
    seenUnknown.add(code)
    const items = itemCounts.get(code) ?? 0
    const totes = toteCounts.get(code) ?? 0
    unknownLocs.push({ code, name: code, items, totes, total: items + totes, known: false, cataloguingBench: false })
  }
  for (const k of itemCounts.keys()) addUnknown(k)
  for (const k of toteCounts.keys()) addUnknown(k)

  const all = [...locations, ...unknownLocs].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" })
  )

  return NextResponse.json({
    locations:          all,
    unlocated:          unlocatedItems + unlocatedTotes,
    unlocatedBreakdown: { items: unlocatedItems, totes: unlocatedTotes },
    auctions:           auctionRows.map(r => r.auctionCode).filter(Boolean) as string[],
    meta: {
      total:             totalItems + totalTotes,
      totalItems,
      totalTotes,
      knownLocations:    locations.length,
      unknownLocations:  unknownLocs.length,
      occupiedLocations: all.filter(l => l.total > 0).length,
      emptyLocations:    all.filter(l => l.total === 0).length,
    },
  })
}
