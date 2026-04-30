import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/auction-ai/runs/[id] — get all lots for a run
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { id } = await params
  try {
    const run = await prisma.auctionRun.findUnique({
      where: { id },
      include: { lots: { orderBy: { createdAt: "asc" } } },
    })
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(run)
  } catch (e: any) {
    console.error("[auction-ai/runs/[id] GET]", e)
    return NextResponse.json({ error: e.message ?? "Database error" }, { status: 500 })
  }
}

// DELETE /api/auction-ai/runs/[id] — delete a specific lot
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { id } = await params
  await prisma.auctionLot.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
