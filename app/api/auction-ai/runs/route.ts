import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/auction-ai/runs — list all runs with lot counts
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  try {
    const runs = await prisma.auctionRun.findMany({
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { lots: true } } },
    })
    return NextResponse.json(runs)
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Database error" }, { status: 500 })
  }
}

// POST /api/auction-ai/runs — upsert run by code, append a lot
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { code, preset, lot, description, estimate, originalDescription, keyPoints, missing, added } = body
  if (!code || !lot) return NextResponse.json({ error: "Missing code or lot" }, { status: 400 })

  try {
    const run = await prisma.auctionRun.upsert({
      where:  { code },
      update: { preset, updatedAt: new Date() },
      create: { code, preset: preset ?? "" },
    })

    // Upsert the individual lot so a re-run after a page refresh doesn't
    // create duplicate AuctionLot records with conflicting descriptions
    const existingLot = await prisma.auctionLot.findFirst({
      where: { runId: run.id, lot },
    })
    if (existingLot) {
      await prisma.auctionLot.update({
        where: { id: existingLot.id },
        data: {
          description:         description         ?? "",
          estimate:            estimate             ?? "",
          originalDescription: originalDescription  ?? null,
          keyPoints:           keyPoints            ?? null,
          missing:             missing              ?? null,
          added:               added                ?? null,
        },
      })
    } else {
      await prisma.auctionLot.create({
        data: {
          runId:               run.id,
          lot,
          description:         description         ?? "",
          estimate:            estimate             ?? "",
          originalDescription: originalDescription  ?? null,
          keyPoints:           keyPoints            ?? null,
          missing:             missing              ?? null,
          added:               added                ?? null,
        },
      })
    }

    return NextResponse.json({ ok: true, runId: run.id })
  } catch (e: any) {
    console.error("[auction-ai/runs POST]", e)
    return NextResponse.json({ error: e.message ?? "Database error" }, { status: 500 })
  }
}

// DELETE /api/auction-ai/runs — delete a run by id
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  try {
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    await prisma.auctionRun.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Database error" }, { status: 500 })
  }
}
