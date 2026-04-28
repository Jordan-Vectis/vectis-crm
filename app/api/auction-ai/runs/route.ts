import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/auction-ai/runs — list all runs with lot counts
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const runs = await prisma.auctionRun.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { lots: true } } },
  })
  return NextResponse.json(runs)
}

// POST /api/auction-ai/runs — upsert run by code, append a lot
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { code, preset, lot, description, estimate, originalDescription, keyPoints, missing, added } = await req.json()
  if (!code || !lot) return NextResponse.json({ error: "Missing code or lot" }, { status: 400 })

  let run: { id: string }
  try {
    run = await prisma.auctionRun.upsert({
      where:  { code },
      update: { preset, updatedAt: new Date() },
      create: { code, preset: preset ?? "" },
    })
  } catch (e: any) {
    console.error("[runs POST] upsert failed:", e)
    return NextResponse.json({ error: `Run upsert failed: ${e.message}` }, { status: 500 })
  }

  try {
    await prisma.auctionLot.create({
      data: {
        runId:               run.id,
        lot:                 String(lot),
        description:         String(description         ?? ""),
        estimate:            String(estimate             ?? ""),
        originalDescription: originalDescription != null ? String(originalDescription) : null,
        keyPoints:           keyPoints           != null ? String(keyPoints)           : null,
        missing:             missing             != null ? String(missing)             : null,
        added:               added               != null ? String(added)               : null,
      },
    })
  } catch (e: any) {
    console.error("[runs POST] lot create failed:", e)
    return NextResponse.json({ error: `Lot create failed: ${e.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, runId: run.id })
}

// DELETE /api/auction-ai/runs — delete a run by id
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

  await prisma.auctionRun.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
