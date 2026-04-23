import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAllWithProgress } from "@/lib/bc"
import { getCachedBC, setCachedBC } from "@/lib/bc-cache"

export const maxDuration = 60

const TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000  // effectively forever — bust via Refresh All Data

function last3MonthsRange(): { start: string; end: string } {
  const now = new Date()
  const endMonth   = new Date(now.getFullYear(), now.getMonth(), 0)
  const startMonth = new Date(now.getFullYear(), now.getMonth() - 3, 1)
  return {
    start: startMonth.toISOString().split("T")[0],
    end:   endMonth.toISOString().split("T")[0],
  }
}

function send(controller: ReadableStreamDefaultController, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n"))
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { start, end } = last3MonthsRange()
  const cacheKey = `collected-monthly:${start}:${end}`

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const hit = await getCachedBC<Record<string, number>>(cacheKey, TTL_MS)
        if (hit) {
          send(controller, { type: "progress", done: 1, total: 1 })
          send(controller, { type: "result", byMonth: hit })
          controller.close()
          return
        }

        const token = await getBCToken()
        if (!token) { send(controller, { type: "error", error: "BC_NOT_CONNECTED" }); controller.close(); return }

        const filter = `New_Value eq 'COLLECTED' and Field_Caption eq 'Article Location Code'`
        const rows = await bcFetchAllWithProgress(token, "ChangeLogEntries", filter, "Primary_Key_Field_1_Value,Date_and_Time", 500,
          (done, total) => send(controller, { type: "progress", done, total })
        )

        const byMonth: Record<string, number> = {}
        for (const row of rows) {
          const d = (row.Date_and_Time ?? "").slice(0, 10)
          if (d < start || d > end) continue
          const month = d.slice(0, 7)
          byMonth[month] = (byMonth[month] ?? 0) + 1
        }

        await setCachedBC(cacheKey, byMonth)
        send(controller, { type: "result", byMonth })
      } catch (e: any) {
        send(controller, { type: "error", error: e.message ?? "Unknown error" })
      }
      controller.close()
    }
  })

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
