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

// Extract a short title from the AI description (first sentence, capped at 100 chars)
function titleFromDescription(desc: string): string {
  const first = desc.split(/[.\n]/)[0].trim()
  return first.length > 100 ? first.slice(0, 97) + "…" : first || "Untitled"
}

// POST /api/auction-ai/runs/[id]/apply
// Creates new CatalogueLot records in the matching CatalogueAuction from a saved AI run.
// Skips lots whose lotNumber already exists in that auction to avoid duplicates.
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { id } = await params

  try {
    const run = await prisma.auctionRun.findUnique({
      where: { id },
      include: { lots: true },
    })
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 })

    // Find the matching catalogue auction by code
    const auction = await prisma.catalogueAuction.findUnique({
      where: { code: run.code },
      select: { id: true, lots: { select: { lotNumber: true, receiptUniqueId: true } } },
    })
    if (!auction) {
      return NextResponse.json(
        { error: `No catalogue auction found with code "${run.code}". Has it been created in Cataloguing first?` },
        { status: 404 },
      )
    }

    // Track existing identifiers so we don't create duplicates
    const existingLotNumbers  = new Set(auction.lots.map(l => l.lotNumber))
    const existingUniqueIds   = new Set(auction.lots.filter(l => l.receiptUniqueId).map(l => l.receiptUniqueId!))

    const skipped: string[] = []
    let created = 0

    await Promise.all(
      run.lots.map(async l => {
        const isUniqueIdFormat = /^[A-Za-z]\d{4,7}-\d{1,6}$/.test(l.lot.trim())
        const alreadyExists = isUniqueIdFormat
          ? existingUniqueIds.has(l.lot)
          : existingLotNumbers.has(l.lot)
        if (alreadyExists) {
          skipped.push(l.lot)
          return
        }
        const { low, high } = parseEstimate(l.estimate)
        // Detect receipt unique ID format e.g. R000016-413 — store in receiptUniqueId,
        // not lotNumber (lot numbers are catalogue sequence numbers, assigned separately)
        const isUniqueId = /^[A-Za-z]\d{4,7}-\d{1,6}$/.test(l.lot.trim())
        await prisma.catalogueLot.create({
          data: {
            auctionId:       auction.id,
            lotNumber:       isUniqueId ? "" : l.lot,
            receiptUniqueId: isUniqueId ? l.lot : null,
            title:           titleFromDescription(l.description),
            description:     l.description,
            estimateLow:     low,
            estimateHigh:    high,
            aiUpgraded:      true,
          },
        })
        created++
      }),
    )

    return NextResponse.json({ ok: true, created, skipped, auctionId: auction.id })
  } catch (e: any) {
    console.error("[auction-ai/runs/[id]/apply POST]", e)
    return NextResponse.json({ error: e.message ?? "Database error" }, { status: 500 })
  }
}
