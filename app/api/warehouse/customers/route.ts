import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

async function genCustomerId(): Promise<string> {
  const count = await prisma.warehouseCustomer.count()
  return `c${String(count + 1).padStart(5, "0")}`
}

export async function GET(req: NextRequest) {
  try {
    await requireWarehouseAccess("warehouse")
    const search = req.nextUrl.searchParams.get("search") || ""
    const customers = await prisma.warehouseCustomer.findMany({
      where: search ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { id: { contains: search, mode: "insensitive" } },
          { postcode: { contains: search, mode: "insensitive" } },
          { addressLine1: { contains: search, mode: "insensitive" } },
          { addressLine2: { contains: search, mode: "insensitive" } },
        ],
      } : undefined,
      orderBy: { name: "asc" },
    })
    return NextResponse.json(customers)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireWarehouseAccess("warehouse")
    const body = await req.json()
    const id = await genCustomerId()
    const customer = await prisma.warehouseCustomer.create({
      data: {
        id,
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
