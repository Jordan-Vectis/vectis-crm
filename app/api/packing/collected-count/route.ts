import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAllWithProgress } from "@/lib/bc"
import { getCachedBC, setCachedBC } from "@/lib/bc-cache"

const TTL_MS = 12 * 60 * 60 * 1000  // 12 hours — bust manually via Refresh All Data

function send(controller: ReadableStreamDefaultController, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n"))
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { searchParams } = req.nextUrl
  const from = searchParams.get("from") ?? ""
  const to   = searchParams.get("to")   ?? ""
  const cacheKey = `collected-count:${from}:${to}`

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const hit = await getCachedBC<number>(cacheKey, TTL_MS)
        if (hit !== null) {
          send(controller, { type: "progress", done: 1, total: 1 })
          send(controller, { type: "result", count: hit })
          controller.close()
          return
        }

        const token = await getBCToken()
        if (!token) { send(controller, { type: "error", error: "BC_NOT_CONNECTED" }); controller.close(); return }

        const filter = `New_Value eq 'COLLECTED' and Field_Caption eq 'Article Location Code'`
        const rows = await bcFetchAllWithProgress(token, "ChangeLogEntries", filter, "Primary_Key_Field_1_Value,Date_and_Time", 500,
          (done, total) => send(controller, { type: "progress", done, total })
        )

        const fromStr = from ? `${from}T00:00:00` : null
        const toStr   = to   ? `${to}T23:59:59`   : null
        const count = rows.filter(r => {
          const d = r.Date_and_Time ?? ""
          if (fromStr && d < fromStr) return false
          if (toStr   && d > toStr)   return false
          return true
        }).length

        await setCachedBC(cacheKey, count)
        send(controller, { type: "result", count })
      } catch (e: any) {
        send(controller, { type: "error", error: e.message ?? "Unknown error" })
      }
      controller.close()
    }
  })

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
