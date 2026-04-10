import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

async function requireAuth() {
  const session = await auth()
  if (!session) throw new Error("Not authenticated")
  return session
}

async function genContactId(): Promise<string> {
  const contacts = await prisma.contact.findMany({ select: { id: true } })
  let maxNum = 0
  for (const c of contacts) {
    const num = parseInt(c.id.replace(/^\D+/, ""), 10)
    if (!isNaN(num) && num > maxNum) maxNum = num
  }
  return `c${String(maxNum + 1).padStart(5, "0")}`
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth()
    const { searchParams } = req.nextUrl
    const search = searchParams.get("search") || ""
    const limit  = Math.min(parseInt(searchParams.get("limit") || "50"), 100)
    const offset = parseInt(searchParams.get("offset") || "0")

    const where = search ? {
      OR: [
        { name:         { contains: search, mode: "insensitive" as const } },
        { phone:        { contains: search, mode: "insensitive" as const } },
        { email:        { contains: search, mode: "insensitive" as const } },
        { id:           { contains: search, mode: "insensitive" as const } },
        { postcode:     { contains: search, mode: "insensitive" as const } },
        { addressLine1: { contains: search, mode: "insensitive" as const } },
        { addressLine2: { contains: search, mode: "insensitive" as const } },
      ],
    } : undefined

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { name: "asc" },
        skip: offset,
        take: limit,
        include: { _count: { select: { receipts: true, submissions: true } } },
      }),
      prisma.contact.count({ where }),
    ])

    return NextResponse.json({ contacts, total, limit, offset })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth()
    const body = await req.json()
    if (!body.name?.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 })
    const id = await genContactId()
    const contact = await prisma.contact.create({
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
    return NextResponse.json(contact)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
