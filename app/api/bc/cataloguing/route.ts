import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 300

const EXCLUDED_USERS = new Set([
  "JORDAN.ORANGE", "JACK.COLLINGS", "MICHELLE.TROTTER", "ANDREW.WILSON",
])

function addDays(date: Date, n: number): Date {
  const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d
}
function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0]
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response(JSON.stringify({ error: "Unauthorised" }), { status: 401 })

  const token = await getBCToken()
  if (!token) return new Response(JSON.stringify({ error: "BC_NOT_CONNECTED" }), { status: 401 })

  const { searchParams } = req.nextUrl
  const from = searchParams.get("from") ?? ""
  const to   = searchParams.get("to")   ?? ""
  if (!from || !to) return new Response(JSON.stringify({ error: "Missing from/to" }), { status: 400 })

  const dateFrom = new Date(from + "T00:00:00Z")
  const dateTo   = new Date(to   + "T00:00:00Z")

  // Build all chunks upfront
  const chunks: { start: Date; end: Date }[] = []
  let chunkStart = dateFrom
  while (chunkStart <= dateTo) {
    const chunkEnd = addDays(chunkStart, 6) > dateTo ? dateTo : addDays(chunkStart, 6)
    chunks.push({ start: chunkStart, end: chunkEnd })
    chunkStart = addDays(chunkEnd, 1)
  }

  const encoder = new TextEncoder()
  const PARALLEL = 4 // fetch this many chunks at once

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
      }

      const allRows: any[] = []
      const total = chunks.length

      // Process in parallel batches
      for (let i = 0; i < chunks.length; i += PARALLEL) {
        const batch = chunks.slice(i, i + PARALLEL)
        const results = await Promise.all(
          batch.map(async ({ start, end }) => {
            const filter =
              `Date_and_Time ge ${toDateStr(start)}T00:00:00Z ` +
              `and Date_and_Time le ${toDateStr(end)}T23:59:59Z ` +
              `and Field_Caption eq 'Internal Barcode'`
            try {
              return await bcFetchAll(token, "ChangeLogEntries", filter, "User_ID,Date_and_Time,Entry_No,Field_Caption")
            } catch {
              return []
            }
          })
        )
        results.forEach(rows => allRows.push(...rows))
        send({ type: "progress", done: Math.min(i + PARALLEL, total), total })
      }

      // Filter excluded users
      const rows = allRows.filter(r => !EXCLUDED_USERS.has(r.User_ID))

      // Daily average
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

      // Total lots
      const userTotals: Record<string, number> = {}
      for (const r of rows) {
        userTotals[r.User_ID] = (userTotals[r.User_ID] ?? 0) + 1
      }
      const totalLots = Object.entries(userTotals)
        .map(([user, total]) => ({ user, total }))
        .sort((a, b) => b.total - a.total)

      // Monthly
      const monthMap: Record<string, { label: string; sort: string; total: number }> = {}
      for (const r of rows) {
        const dt = new Date(r.Date_and_Time)
        const sort  = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`
        const label = dt.toLocaleString("en-GB", { month: "long", year: "numeric" })
        if (!monthMap[sort]) monthMap[sort] = { label, sort, total: 0 }
        monthMap[sort].total++
      }
      const monthly = Object.values(monthMap).sort((a, b) => a.sort.localeCompare(b.sort))

      const userCount = new Set(rows.map(r => r.User_ID)).size

      send({ type: "result", data: { dailyAvg, totalLots, monthly, meta: { total: rows.length, userCount } } })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "X-Content-Type-Options": "nosniff" },
  })
}
