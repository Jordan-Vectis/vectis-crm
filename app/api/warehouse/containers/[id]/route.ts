import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWarehouseAccess("warehouse")
    const { id } = await params
    const container = await prisma.warehouseContainer.findUnique({
      where: { id },
      include: {
        movements: {
          orderBy: { movedAt: "desc" },
          take: 1,
          include: { location: true },
        },
      },
    })
    if (!container) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({
      id: container.id,
      type: container.type,
      description: container.description,
      receipt_id: container.receiptId,
      current_location: container.movements[0]?.location.code ?? null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWarehouseAccess("warehouse")
    const { id } = await params
    const body = await req.json()
    const container = await prisma.warehouseContainer.update({
      where: { id },
      data: {
        type: body.type,
        description: body.description,
        category: body.category ?? undefined,
        subcategory: body.subcategory ?? undefined,
      },
    })
    return NextResponse.json({
      id: container.id,
      type: container.type,
      description: container.description,
      category: container.category,
      subcategory: container.subcategory,
      receipt_id: container.receiptId,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
