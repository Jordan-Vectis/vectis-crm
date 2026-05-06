import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/tote/report
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const [toteStats, byLocation, recentTotes, totesPerCategory] = await Promise.all([
    // Overall tote counts from WarehouseTote
    prisma.warehouseTote.groupBy({
      by: ["catalogued"],
      _count: { _all: true },
    }),

    // Totes grouped by location (top 20)
    prisma.warehouseTote.groupBy({
      by: ["location"],
      where: { location: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { location: "desc" } },
      take: 20,
    }),

    // Active totes list (not catalogued)
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

    // Distinct tote count per category, sourced directly from WarehouseItem.
    // We count distinct toteNo values per category — no join with WarehouseTote
    // needed, which avoids the match rate problem when the two tables don't align.
    prisma.$queryRaw<{ category: string | null; toteCount: bigint; itemCount: bigint }[]>`
      SELECT
        category,
        COUNT(DISTINCT "toteNo") AS "toteCount",
        COUNT(*)                 AS "itemCount"
      FROM "WarehouseItem"
      WHERE "toteNo" IS NOT NULL
      GROUP BY category
      ORDER BY "toteCount" DESC
    `,
  ])

  const totalTotes  = toteStats.reduce((s, g) => s + g._count._all, 0)
  const activeTotes = toteStats.find(g => g.catalogued === false)?._count._all ?? 0
  const doneTotes   = toteStats.find(g => g.catalogued === true)?._count._all  ?? 0
  const unknownTotes = toteStats.find(g => g.catalogued === null)?._count._all ?? 0

  return NextResponse.json({
    stats: { total: totalTotes, active: activeTotes, catalogued: doneTotes, unknown: unknownTotes },
    byCategory: totesPerCategory.map(r => ({
      category:    r.category ?? "Unknown",
      itemCount:   Number(r.itemCount),
      activeTotes: Number(r.toteCount),   // kept as activeTotes so the frontend type stays the same
    })),
    byLocation: byLocation.map(g => ({ location: g.location, toteCount: g._count._all })),
    totes: recentTotes,
  })
}
