import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 60

function last3MonthsRange(): { start: string; end: string } {
  const now = new Date()
  const endMonth   = new Date(now.getFullYear(), now.getMonth(), 0)      // last day of previous month
  const startMonth = new Date(now.getFullYear(), now.getMonth() - 3, 1) // first day 3 months ago
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

    const { start, end } = last3MonthsRange()

    const filter = `EVA_AuctionDate ge ${start} and EVA_AuctionDate le ${end}`
    const filtered = await bcFetchAll(
      token,
      "EVA_AuctionLine",
      filter,
      "EVA_AuctionNo,EVA_AuctionDate",
      500
    )

    // Group by YYYY-MM
    const byMonth: Record<string, { count: number; auctions: Set<string> }> = {}
    for (const row of filtered) {
      const month = (row.EVA_AuctionDate ?? "").slice(0, 7)
      if (!month) continue
      if (!byMonth[month]) byMonth[month] = { count: 0, auctions: new Set() }
      byMonth[month].count++
      if (row.EVA_AuctionNo) byMonth[month].auctions.add(row.EVA_AuctionNo)
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
    const totalAuctions = new Set(filtered.map(r => r.EVA_AuctionNo).filter(Boolean)).size
    const avgPerAuction = totalAuctions > 0 ? Math.round(filtered.length / totalAuctions) : 0

    return NextResponse.json({ months, avgLots, avgPerAuction, totalAuctions, total: filtered.length, range: { start, end } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
