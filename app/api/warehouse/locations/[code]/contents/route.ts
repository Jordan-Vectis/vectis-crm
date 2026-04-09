import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  try {
    await requireWarehouseAccess("warehouse")
    const { code } = await params
    const locationCode = code.toUpperCase()

    // Get all containers currently at this location
    // A container is "at" a location if its most recent movement is to this location
    const containers = await prisma.warehouseContainer.findMany({
      include: {
        movements: {
          orderBy: { movedAt: "desc" },
          take: 1,
          include: { location: true },
        },
      },
    })

    const here = containers.filter(c =>
      c.movements.length > 0 && c.movements[0].location.code === locationCode
    )

    return NextResponse.json(here.map(c => ({
      container_id: c.id,
      type: c.type,
      description: c.description,
      receipt_id: c.receiptId,
    })))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
