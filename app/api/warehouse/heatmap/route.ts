import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import LOCATIONS from "@/lib/warehouse-locations.json"

// GET /api/warehouse/heatmap
// Reads WarehouseItem from DB and groups by location.
// Returns ALL known locations (from warehouse-locations.json), even empty ones,
// plus any "unknown" locations the DB has that aren't in the master list.
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const [grouped, unlocated, total] = await Promise.all([
    prisma.warehouseItem.groupBy({
      by: ["location"],
      where: { location: { not: null, notIn: ["", " "] } },
      _count: { _all: true },
    }),
    prisma.warehouseItem.count({ where: { OR: [{ location: null }, { location: "" }] } }),
    prisma.warehouseItem.count(),
  ])

  // DB count by location code (case-insensitive trim)
  const counts = new Map<string, number>()
  for (const g of grouped) {
    const code = (g.location ?? "").trim().toUpperCase()
    if (!code) continue
    counts.set(code, (counts.get(code) ?? 0) + g._count._all)
  }

  // Build list from master JSON, filling in counts
  const known = LOCATIONS as { code: string; name: string; cataloguingBench?: boolean }[]
  const knownCodes = new Set(known.map(l => l.code.toUpperCase()))

  const locations = known.map(l => ({
    code:  l.code,
    name:  l.name,
    total: counts.get(l.code.toUpperCase()) ?? 0,
    known: true,
    cataloguingBench: l.cataloguingBench ?? false,
  }))

  // Any locations in the DB that aren't in the master list — show as "unknown"
  const unknownLocs: { code: string; name: string; total: number; known: boolean; cataloguingBench: boolean }[] = []
  for (const [code, total] of counts) {
    if (!knownCodes.has(code)) unknownLocs.push({ code, name: code, total, known: false, cataloguingBench: false })
  }

  // Sort by code (numeric-aware)
  const all = [...locations, ...unknownLocs].sort((a, b) =>
    a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" })
  )

  return NextResponse.json({
    locations: all,
    unlocated,
    meta: {
      total,
      knownLocations:    locations.length,
      unknownLocations:  unknownLocs.length,
      occupiedLocations: all.filter(l => l.total > 0).length,
      emptyLocations:    all.filter(l => l.total === 0).length,
    },
  })
}
