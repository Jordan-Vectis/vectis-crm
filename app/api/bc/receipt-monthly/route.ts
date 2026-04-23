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

    // DEBUG: fetch 1 row to discover field names
    const sample = await bcPage(token, "Auction_Receipt_Lines_Excel", { $top: 1 })
    return NextResponse.json({ debug_fields: sample.length > 0 ? Object.keys(sample[0]) : [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
