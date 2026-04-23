import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

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
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

  const { start, end } = last3MonthsRange()
  const filter = `Auction_Date ge ${start} and Auction_Date le ${end}`

  const rows = await bcFetchAll(token, "Auction_Receipt_Lines_Excel", filter, undefined, 500)

  // Group by YYYY-MM
  const byMonth: Record<string, number> = {}
  for (const row of rows) {
    const date: string = row.Auction_Date ?? ""
    if (!date) continue
    const month = date.slice(0, 7)
    byMonth[month] = (byMonth[month] ?? 0) + 1
  }

  const months = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }))

  const avg = months.length > 0
    ? Math.round(months.reduce((s, m) => s + m.count, 0) / months.length)
    : 0

  return NextResponse.json({ months, avg, total: rows.length, range: { start, end } })
}
