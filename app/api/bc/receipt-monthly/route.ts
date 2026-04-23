import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll, bcPage } from "@/lib/bc"

export const maxDuration = 60

function last3MonthsRange(): { start: string; end: string } {
  const now = new Date()
  const endMonth   = new Date(now.getFullYear(), now.getMonth(), 0)       // last day of previous month
  const startMonth = new Date(now.getFullYear(), now.getMonth() - 3, 1)  // first day 3 months ago
  return {
    start: startMonth.toISOString().split("T")[0],
    end:   endMonth.toISOString().split("T")[0],
  }
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

    // DEBUG: discover fields on EVA_AuctionLine
    const sample = await bcPage(token, "EVA_AuctionLine", { $top: 1 })
    return NextResponse.json({ debug_fields: sample.length > 0 ? Object.keys(sample[0]) : [] })

    const { start, end } = last3MonthsRange()
    const filter = `EVA_CataloguedDateTime ge ${start}T00:00:00Z and EVA_CataloguedDateTime le ${end}T23:59:59Z`

    const rows = await bcFetchAll(token, "Auction_Receipt_Lines_Excel", filter, undefined, 500)

    // Group by YYYY-MM using EVA_CataloguedDateTime
    const byMonth: Record<string, { count: number; auctions: Set<string> }> = {}
    for (const row of rows) {
      const date: string = row.EVA_CataloguedDateTime ?? ""
      if (!date) continue
      const month = date.slice(0, 7)
      if (!byMonth[month]) byMonth[month] = { count: 0, auctions: new Set() }
      byMonth[month].count++
      if (row.EVA_SalesAllocation) byMonth[month].auctions.add(row.EVA_SalesAllocation)
    }

    const months = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, { count, auctions }]) => ({
        month,
        count,
        auctions: auctions.size,
        avgPerAuction: auctions.size > 0 ? Math.round(count / auctions.size) : 0,
      }))

    const avgLots = months.length > 0
      ? Math.round(months.reduce((s, m) => s + m.count, 0) / months.length)
      : 0
    const totalAuctions = new Set(rows.map(r => r.EVA_SalesAllocation).filter(Boolean)).size
    const avgPerAuction = totalAuctions > 0 ? Math.round(rows.length / totalAuctions) : 0

    return NextResponse.json({ months, avgLots, avgPerAuction, totalAuctions, total: rows.length, range: { start, end } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
