import { NextRequest, NextResponse } from "next/server"

export const maxDuration = 60
import { auth } from "@/auth"
import { getBCToken } from "@/lib/bc"
import { getCollectedDates } from "@/lib/collected-cache"

function send(controller: ReadableStreamDefaultController, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + "\n"))
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { searchParams } = req.nextUrl
  const from = searchParams.get("from") ?? ""
  const to   = searchParams.get("to")   ?? ""

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const token = await getBCToken()
        if (!token) { send(controller, { type: "error", error: "BC_NOT_CONNECTED" }); controller.close(); return }

        const dates = await getCollectedDates(token,
          (done, total) => send(controller, { type: "progress", done, total })
        )

        const fromStr = from ? `${from}T00:00:00` : null
        const toStr   = to   ? `${to}T23:59:59`   : null
        const count = dates.filter(d => {
          if (fromStr && d < fromStr) return false
          if (toStr   && d > toStr)   return false
          return true
        }).length

        send(controller, { type: "result", count })
      } catch (e: any) {
        send(controller, { type: "error", error: e.message ?? "Unknown error" })
      }
      controller.close()
    }
  })

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
