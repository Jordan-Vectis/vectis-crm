import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/tote/report
// Tote summary report: totes grouped by category (via WarehouseItem),
// plus overall tote stats from WarehouseTote.
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const [toteStats, byCategory, byLocation, recentTotes] = await Promise.all([
    // Overall tote counts
    prisma.warehouseTote.groupBy({
      by: ["catalogued"],
      _count: { _all: true },
    }),

    // Items in totes grouped by category — gives "X items of category Y are in totes"
    prisma.warehouseItem.groupBy({
      by: ["category"],
      where: { toteNo: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { category: "desc" } },
    }),

    // Totes grouped by location
    prisma.warehouseTote.groupBy({
      by: ["location"],
      where: { location: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { location: "desc" } },
      take: 20,
    }),

    // Most recently synced active totes
    prisma.warehouseTote.findMany({
      where: { catalogued: { not: true } },
      select: {
        toteNo:     true,
        location:   true,
        receiptNo:  true,
        vendorName: true,
        status:     true,
        catalogued: true,
        syncedAt:   true,
      },
      orderBy: { toteNo: "asc" },
      take: 500,
    }),
  ])

  const totalTotes   = toteStats.reduce((s, g) => s + g._count._all, 0)
  const activeTotes  = toteStats.find(g => g.catalogued === false)?._count._all ?? 0
  const doneTotes    = toteStats.find(g => g.catalogued === true)?._count._all ?? 0
  const unknownTotes = toteStats.find(g => g.catalogued === null)?._count._all ?? 0

  return NextResponse.json({
    stats: { total: totalTotes, active: activeTotes, catalogued: doneTotes, unknown: unknownTotes },
    byCategory: byCategory.map(g => ({ category: g.category ?? "Unknown", itemCount: g._count._all })),
    byLocation: byLocation.map(g => ({ location: g.location, toteCount: g._count._all })),
    totes: recentTotes,
  })
}
