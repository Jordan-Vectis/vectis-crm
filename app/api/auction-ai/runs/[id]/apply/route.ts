import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

function parseEstimate(est: string): { low: number | null; high: number | null } {
  const m = est.match(/£([\d,]+)\s*[–\-]\s*£?([\d,]+)/)
  if (!m) return { low: null, high: null }
  return {
    low:  parseInt(m[1].replace(/,/g, ""), 10),
    high: parseInt(m[2].replace(/,/g, ""), 10),
  }
}

// POST /api/auction-ai/runs/[id]/apply
// Applies AI descriptions + estimates from a saved run into the matching CatalogueAuction lots.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { id } = await params

  const run = await prisma.auctionRun.findUnique({
    where: { id },
    include: { lots: true },
  })
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 })

  // Find the matching catalogue auction by code
  const auction = await prisma.catalogueAuction.findUnique({
    where: { code: run.code },
    select: { id: true, lots: { select: { id: true, lotNumber: true } } },
  })
  if (!auction) {
    return NextResponse.json(
      { error: `No catalogue auction found with code "${run.code}". Has it been created in Cataloguing?` },
      { status: 404 },
    )
  }

  // Build a map of lotNumber → CatalogueLot id
  const lotMap = new Map(auction.lots.map(l => [l.lotNumber, l.id]))

  const notFound: string[] = []
  let applied = 0

  await Promise.all(
    run.lots.map(async l => {
      const catalogueLotId = lotMap.get(l.lot)
      if (!catalogueLotId) {
        notFound.push(l.lot)
        return
      }
      const { low, high } = parseEstimate(l.estimate)
      await prisma.catalogueLot.update({
        where: { id: catalogueLotId },
        data: {
          description:  l.description,
          estimateLow:  low,
          estimateHigh: high,
          aiUpgraded:   true,
        },
      })
      applied++
    }),
  )

  return NextResponse.json({ ok: true, applied, notFound, auctionId: auction.id })
}
