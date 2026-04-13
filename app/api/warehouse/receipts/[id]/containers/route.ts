import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWarehouseAccess("warehouse")
    const { id } = await params
    const containers = await prisma.warehouseContainer.findMany({
      where: { receiptId: id },
      include: {
        movements: { orderBy: { movedAt: "desc" }, take: 1, include: { location: true } },
      },
    })
    const containerIds = containers.map(c => c.id)
    const lotCounts = await prisma.catalogueLot.groupBy({
      by: ["tote"],
      where: { tote: { in: containerIds } },
      _count: { tote: true },
    })
    const lotCountMap = Object.fromEntries(lotCounts.map(l => [l.tote!, l._count.tote]))
    return NextResponse.json(containers.map(c => ({
      id: c.id,
      type: c.type,
      description: c.description,
      category: c.category,
      subcategory: c.subcategory,
      receipt_id: c.receiptId,
      current_location: c.movements[0]?.location.code ?? null,
      lot_count: lotCountMap[c.id] ?? 0,
    })))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
