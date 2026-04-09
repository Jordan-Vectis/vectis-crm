import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 300

const EXCLUDED_USERS = new Set([
  "JORDAN.ORANGE", "JACK.COLLINGS", "MICHELLE.TROTTER", "ANDREW.WILSON",
])

// Mirror Python's rolling 7-day chunk logic exactly
function addDays(date: Date, n: number): Date {
  const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d
}
function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

  const { searchParams } = req.nextUrl
  const from = searchParams.get("from") ?? ""
  const to   = searchParams.get("to")   ?? ""
  if (!from || !to) return NextResponse.json({ error: "Missing from/to" }, { status: 400 })

  // Parse as UTC dates (matching Python date objects)
  const dateFrom = new Date(from + "T00:00:00Z")
  const dateTo   = new Date(to   + "T00:00:00Z")

  const allRows: any[] = []

  // Exact rolling 7-day chunks matching Python:
  // chunk_start = date_from
  // chunk_end   = min(chunk_start + 6 days, date_to)
  // next chunk  = chunk_end + 1 day
  let chunkStart = dateFrom
  while (chunkStart <= dateTo) {
    const chunkEnd = addDays(chunkStart, 6) > dateTo ? dateTo : addDays(chunkStart, 6)

    const filter =
      `Date_and_Time ge ${toDateStr(chunkStart)}T00:00:00Z ` +
      `and Date_and_Time le ${toDateStr(chunkEnd)}T23:59:59Z ` +
      `and Field_Caption eq 'Internal Barcode'`

    try {
      const rows = await bcFetchAll(
        token,
        "ChangeLogEntries",
        filter,
        "User_ID,Date_and_Time,Entry_No,Field_Caption",
      )
      allRows.push(...rows)
    } catch (_) {
      // skip failed chunks
    }

    chunkStart = addDays(chunkEnd, 1)
  }

  // Filter excluded users
  const rows = allRows.filter((r) => !EXCLUDED_USERS.has(r.User_ID))

  // --- Daily average ---
  const userDayCounts: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    const user = r.User_ID
    const day  = r.Date_and_Time?.slice(0, 10) ?? ""
    if (!userDayCounts[user]) userDayCounts[user] = {}
    userDayCounts[user][day] = (userDayCounts[user][day] ?? 0) + 1
  }
  const dailyAvg = Object.entries(userDayCounts)
    .map(([user, days]) => {
      const vals = Object.values(days)
      return { user, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 }
    })
    .sort((a, b) => b.avg - a.avg)

  // --- Total lots ---
  const userTotals: Record<string, number> = {}
  for (const r of rows) {
    userTotals[r.User_ID] = (userTotals[r.User_ID] ?? 0) + 1
  }
  const totalLots = Object.entries(userTotals)
    .map(([user, total]) => ({ user, total }))
    .sort((a, b) => b.total - a.total)

  // --- Monthly ---
  const monthMap: Record<string, { label: string; sort: string; total: number }> = {}
  for (const r of rows) {
    const dt = new Date(r.Date_and_Time)
    const sort  = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`
    const label = dt.toLocaleString("en-GB", { month: "long", year: "numeric" })
    if (!monthMap[sort]) monthMap[sort] = { label, sort, total: 0 }
    monthMap[sort].total++
  }
  const monthly = Object.values(monthMap).sort((a, b) => a.sort.localeCompare(b.sort))

  const userCount = new Set(rows.map((r) => r.User_ID)).size

  return NextResponse.json({ dailyAvg, totalLots, monthly, meta: { total: rows.length, userCount } })
}
