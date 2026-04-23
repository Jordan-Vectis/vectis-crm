import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"
import { getCachedBC, setCachedBC } from "@/lib/bc-cache"

export const maxDuration = 60

const TTL_MS = 60 * 60 * 1000 // 1 hour

function last3MonthsRange(): { start: string; end: string } {
  const now = new Date()
  const endMonth   = new Date(now.getFullYear(), now.getMonth(), 0)
  const startMonth = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  return {
    start: startMonth.toISOString().split("T")[0],
    end:   endMonth.toISOString().split("T")[0],
  }
}

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { start, end } = last3MonthsRange()
    const cacheKey = `collected-monthly:${start}:${end}`

    const hit = await getCachedBC<Record<string, number>>(cacheKey, TTL_MS)
    if (hit) return NextResponse.json({ byMonth: hit, fromCache: true })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

    const filter = `New_Value eq 'COLLECTED' and Field_Caption eq 'Article Location Code' and Date_and_Time ge ${start}`
    const rows = await bcFetchAll(token, "ChangeLogEntries", filter, "Primary_Key_Field_1_Value,Date_and_Time", 500)

    const byMonth: Record<string, number> = {}
    for (const row of rows) {
      const d = (row.Date_and_Time ?? "").slice(0, 10)
      if (d < start || d > end) continue
      const month = d.slice(0, 7)
      byMonth[month] = (byMonth[month] ?? 0) + 1
    }

    await setCachedBC(cacheKey, byMonth)
    return NextResponse.json({ byMonth })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
