import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function GET(req: NextRequest) {
  try {
    await requireWarehouseAccess("manager")
    const containerId = req.nextUrl.searchParams.get("container_id")
    const location = req.nextUrl.searchParams.get("location")
    const dateFrom = req.nextUrl.searchParams.get("date_from")
    const dateTo = req.nextUrl.searchParams.get("date_to")

    const movements = await prisma.warehouseMovement.findMany({
      where: {
        ...(containerId ? { containerId: { contains: containerId, mode: "insensitive" } } : {}),
        ...(location ? { locationCode: { contains: location, mode: "insensitive" } } : {}),
        ...(dateFrom || dateTo ? {
          movedAt: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo + "T23:59:59Z") } : {}),
          },
        } : {}),
      },
      include: { container: true, location: true },
      orderBy: { movedAt: "desc" },
      take: 500,
    })

    return NextResponse.json(movements.map(m => ({
      id: m.id,
      container_id: m.containerId,
      container_type: m.container.type,
      container_description: m.container.description,
      location_code: m.locationCode,
      moved_at: m.movedAt,
      moved_by: m.movedByName ?? "",
      notes: m.notes ?? "",
    })))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
