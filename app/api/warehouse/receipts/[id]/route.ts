import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWarehouseAccess("warehouse")
    const { id } = await params
    const receipt = await prisma.warehouseReceipt.findUnique({
      where: { id },
      include: { customer: true },
    })
    if (!receipt) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({
      id: receipt.id,
      customer_id: receipt.customerId,
      customer_name: receipt.customer.name,
      commission_rate: receipt.commissionRate,
      notes: receipt.notes,
      status: receipt.status,
      created_at: receipt.createdAt,
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
    const data: Record<string, unknown> = {}
    if (body.commission_rate !== undefined) data.commissionRate = parseFloat(body.commission_rate) || 0
    if (body.notes !== undefined) data.notes = body.notes || null
    if (body.status !== undefined) data.status = body.status
    if (body.customer_id !== undefined) data.customerId = body.customer_id
    const receipt = await prisma.warehouseReceipt.update({
      where: { id },
      data,
      include: { customer: true },
    })
    return NextResponse.json({
      id: receipt.id,
      customer_id: receipt.customerId,
      customer_name: receipt.customer.name,
      commission_rate: receipt.commissionRate,
      notes: receipt.notes,
      status: receipt.status,
      created_at: receipt.createdAt,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
