import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/heatmap
// Reads WarehouseItem from DB and groups by location — instant, no BC calls.
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const [grouped, unlocated, total] = await Promise.all([
    prisma.warehouseItem.groupBy({
      by: ["location"],
      where: { location: { not: null, notIn: ["", " "] } },
      _count: { _all: true },
      orderBy: { location: "asc" },
    }),
    prisma.warehouseItem.count({ where: { OR: [{ location: null }, { location: "" }] } }),
    prisma.warehouseItem.count(),
  ])

  const locations = grouped.map(g => ({
    code:  g.location!,
    total: g._count._all,
  })).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }))

  return NextResponse.json({
    locations,
    unlocated,
    meta: {
      total,
      occupiedLocations: locations.filter(l => l.total > 0).length,
    },
  })
}
