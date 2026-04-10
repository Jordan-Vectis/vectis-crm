import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWarehouseAccess("warehouse")
    const { id } = await params
    const customer = await prisma.warehouseCustomer.findUnique({ where: { id } })
    if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(customer)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWarehouseAccess("warehouse")
    const { id } = await params
    const body = await req.json()
    const customer = await prisma.warehouseCustomer.update({
      where: { id },
      data: {
        salutation: body.salutation || null,
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        addressLine1: body.addressLine1 || null,
        addressLine2: body.addressLine2 || null,
        postcode: body.postcode || null,
        notes: body.notes || null,
      },
    })
    return NextResponse.json(customer)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
