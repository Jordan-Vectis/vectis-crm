import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireWarehouseAccess("warehouse")
    const { id } = await params

    const receipts = await prisma.warehouseReceipt.findMany({
      where: { contactId: id },
      select: { id: true },
    })

    if (receipts.length === 0) return NextResponse.json([])

    const lots = await prisma.catalogueLot.findMany({
      where: {
        OR: receipts.map(r => ({ receipt: { startsWith: r.id + "-" } })),
      },
      select: {
        auctionId: true,
        auction: { select: { id: true, code: true, name: true, auctionDate: true } },
      },
    })

    const seen = new Set<string>()
    const auctions: { id: string; code: string; name: string; auctionDate: string | null }[] = []
    for (const lot of lots) {
      if (lot.auction && !seen.has(lot.auction.id)) {
        seen.add(lot.auction.id)
        auctions.push({
          ...lot.auction,
          auctionDate: lot.auction.auctionDate?.toISOString() ?? null,
        })
      }
    }

    auctions.sort((a, b) => (b.auctionDate ?? "").localeCompare(a.auctionDate ?? ""))

    return NextResponse.json(auctions)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
