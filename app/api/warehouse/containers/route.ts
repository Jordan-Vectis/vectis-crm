import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function GET(req: NextRequest) {
  try {
    await requireWarehouseAccess("warehouse")
    const search = req.nextUrl.searchParams.get("search") ?? ""
    const containers = await prisma.warehouseContainer.findMany({
      where: search ? {
        OR: [
          { id: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      } : {},
      include: { receipt: { include: { contact: true } } },
      take: 20,
      orderBy: { id: "asc" },
    })
    return NextResponse.json(containers.map(c => ({
      id: c.id,
      type: c.type,
      description: c.description,
      receipt_id: c.receiptId,
      customer_id: c.receipt.contact.id,
      customer_name: c.receipt.contact.name,
    })))
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}

async function genContainerId(type: string): Promise<string> {
  const prefix = type === "pallet" ? "p" : "t"
  const count = await prisma.warehouseContainer.count({ where: { type } })
  const digits = type === "pallet" ? 5 : 6
  return `${prefix}${String(count + 1).padStart(digits, "0")}`
}

export async function POST(req: NextRequest) {
  try {
    await requireWarehouseAccess("warehouse")
    const body = await req.json()
    let id: string
    if (body.id) {
      const existing = await prisma.warehouseContainer.findUnique({ where: { id: body.id } })
      if (existing) return NextResponse.json({ error: `ID ${body.id} is already in use` }, { status: 400 })
      id = body.id
    } else {
      id = await genContainerId(body.type || "tote")
    }
    const container = await prisma.warehouseContainer.create({
      data: {
        id,
        type: body.type || "tote",
        description: body.description,
        category: body.category || null,
        subcategory: body.subcategory || null,
        receiptId: body.receipt_id,
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
