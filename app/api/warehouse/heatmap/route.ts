import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import LOCATIONS from "@/lib/warehouse-locations.json"

// GET /api/warehouse/heatmap
// Combined item + tote counts per location, with all known locations included
// (even empty ones) so the heatmap shows the whole warehouse.
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const [groupedItems, groupedTotes, unlocatedItems, unlocatedTotes, totalItems, totalTotes] = await Promise.all([
    prisma.warehouseItem.groupBy({
      by: ["location"],
      where: { location: { not: null, notIn: ["", " "] } },
      _count: { _all: true },
    }),
    prisma.warehouseTote.groupBy({
      by: ["location"],
      where: { location: { not: null, notIn: ["", " "] } },
      _count: { _all: true },
    }),
    prisma.warehouseItem.count({ where: { OR: [{ location: null }, { location: "" }] } }),
    prisma.warehouseTote.count({ where: { OR: [{ location: null }, { location: "" }] } }),
    prisma.warehouseItem.count(),
    prisma.warehouseTote.count(),
  ])

  // Per-location counts (case-insensitive trim)
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

  const known = LOCATIONS as { code: string; name: string; cataloguingBench?: boolean }[]
  const knownCodes = new Set(known.map(l => l.code.toUpperCase()))

  const locations = known.map(l => {
    const k = l.code.toUpperCase()
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

  // Unknown locations: any code that appears in either map but isn't in the master list
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
    locations: all,
    unlocated: unlocatedItems + unlocatedTotes,
    unlocatedBreakdown: { items: unlocatedItems, totes: unlocatedTotes },
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
