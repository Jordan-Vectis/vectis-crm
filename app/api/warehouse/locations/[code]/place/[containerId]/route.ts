import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string; containerId: string }> }) {
  try {
    const { session } = await requireWarehouseAccess("warehouse")
    const { code, containerId } = await params
    const body = await req.json()
    const locationCode = code.toUpperCase()

    // Upsert location
    await prisma.warehouseLocation.upsert({
      where: { code: locationCode },
      update: {},
      create: { code: locationCode },
    })

    // Record movement
    const movement = await prisma.warehouseMovement.create({
      data: {
        containerId,
        locationCode,
        notes: body.notes || null,
        movedByName: session.user.name,
      },
    })

    return NextResponse.json({ ok: true, movement_id: movement.id })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
