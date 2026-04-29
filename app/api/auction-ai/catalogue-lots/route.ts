import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/auction-ai/catalogue-lots?code=F051
// Returns catalogue lots with key points (stored as lot.description in the wizard)
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase()
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 })

  const auction = await prisma.catalogueAuction.findFirst({
    where: { code },
    include: {
      lots: {
        select: { id: true, lotNumber: true, title: true, keyPoints: true, description: true, barcode: true },
        orderBy: { lotNumber: "asc" },
      },
    },
  })

  if (!auction) return NextResponse.json({ error: `No catalogue auction found for code "${code}"` }, { status: 404 })

  auction.lots.sort((a, b) => {
    const na = parseInt(a.lotNumber), nb = parseInt(b.lotNumber)
    return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.lotNumber.localeCompare(b.lotNumber, undefined, { numeric: true })
  })

  return NextResponse.json({
    auctionId: auction.id,
    code:      auction.code,
    lots:      auction.lots.map(l => ({
      id:          l.id,
      lotNumber:   l.lotNumber,
      title:       l.title,
      keyPoints:   l.keyPoints ?? "",
      description: l.description ?? "",
      barcode:     l.barcode ?? null,
    })),
  })
}
