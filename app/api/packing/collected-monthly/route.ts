import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken } from "@/lib/bc"
import { getCollectedDates } from "@/lib/collected-cache"

export const maxDuration = 60

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

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const token = await getBCToken()
        if (!token) { send(controller, { type: "error", error: "BC_NOT_CONNECTED" }); controller.close(); return }

        const dates = await getCollectedDates(token,
          (done, total) => send(controller, { type: "progress", done, total })
        )

        const byMonth: Record<string, number> = {}
        for (const d of dates) {
          const day = d.slice(0, 10)
          if (day < start || day > end) continue
          const month = day.slice(0, 7)
          byMonth[month] = (byMonth[month] ?? 0) + 1
        }

        send(controller, { type: "result", byMonth })
      } catch (e: any) {
        send(controller, { type: "error", error: e.message ?? "Unknown error" })
      }
      controller.close()
    }
  })

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
