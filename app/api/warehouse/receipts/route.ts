import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

async function genReceiptId(): Promise<string> {
  const count = await prisma.warehouseReceipt.count()
  return `r${String(count + 1).padStart(5, "0")}`
}

export async function GET(req: NextRequest) {
  try {
    await requireWarehouseAccess("warehouse")
    const customerId = req.nextUrl.searchParams.get("customer_id")
    const status = req.nextUrl.searchParams.get("status")
    const receipts = await prisma.warehouseReceipt.findMany({
      where: {
        ...(customerId ? { customerId } : {}),
        ...(status ? { status } : {}),
      },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json(receipts.map(r => ({
      id: r.id,
      customer_id: r.customerId,
      customer_name: r.customer.name,
      commission_rate: r.commissionRate,
      notes: r.notes,
      status: r.status,
      created_at: r.createdAt,
    })))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireWarehouseAccess("warehouse")
    const body = await req.json()
    const id = await genReceiptId()
    const receipt = await prisma.warehouseReceipt.create({
      data: {
        id,
        customerId: body.customer_id,
        commissionRate: parseFloat(body.commission_rate) || 0,
        notes: body.notes || null,
      },
    })
    return NextResponse.json({
      id: receipt.id,
      customer_id: receipt.customerId,
      commission_rate: receipt.commissionRate,
      notes: receipt.notes,
      status: receipt.status,
      created_at: receipt.createdAt,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
