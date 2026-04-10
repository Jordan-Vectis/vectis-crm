import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

async function requireAuth() {
  const session = await auth()
  if (!session) throw new Error("Not authenticated")
  return session
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const contact = await prisma.contact.findUnique({ where: { id } })
    if (!contact) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(contact)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth()
    const { id } = await params
    const body = await req.json()
    const contact = await prisma.contact.update({
      where: { id },
      data: {
        salutation: body.salutation ?? undefined,
        name: body.name ?? undefined,
        email: body.email ?? undefined,
        phone: body.phone ?? undefined,
        addressLine1: body.addressLine1 ?? undefined,
        addressLine2: body.addressLine2 ?? undefined,
        postcode: body.postcode ?? undefined,
        notes: body.notes ?? undefined,
      },
    })
    return NextResponse.json(contact)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
