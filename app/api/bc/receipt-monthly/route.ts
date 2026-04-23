import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAllWithProgress } from "@/lib/bc"
import { getCachedBC, setCachedBC } from "@/lib/bc-cache"

export const maxDuration = 60

const TTL_MS = 60 * 60 * 1000

type CachedResult = { months: any[]; avgLots: number; avgPerAuction: number; totalAuctions: number; total: number; range: { start: string; end: string } }

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
  const cacheKey = `receipt-monthly:${start}:${end}`

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const hit = await getCachedBC<CachedResult>(cacheKey, TTL_MS)
        if (hit) {
          send(controller, { type: "progress", done: 1, total: 1 })
          send(controller, { type: "result", data: hit })
          controller.close()
          return
        }

        const token = await getBCToken()
        if (!token) { send(controller, { type: "error", error: "BC_NOT_CONNECTED" }); controller.close(); return }

        const filter = `EVA_AuctionDate ge ${start} and EVA_AuctionDate le ${end}`
        const filtered = await bcFetchAllWithProgress(token, "EVA_AuctionLine", filter, "EVA_AuctionNo,EVA_AuctionDate", 500,
          (done, total) => send(controller, { type: "progress", done, total })
        )

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
            month, count,
            auctions: auctions.size,
            avgPerAuction: auctions.size > 0 ? Math.round(count / auctions.size) : 0,
          }))

        const avgLots = months.length > 0
          ? Math.round(months.reduce((s, m) => s + m.count, 0) / months.length)
          : 0
        const totalAuctions = new Set(filtered.map(r => r.EVA_AuctionNo).filter(Boolean)).size
        const avgPerAuction = totalAuctions > 0 ? Math.round(filtered.length / totalAuctions) : 0

        const result: CachedResult = { months, avgLots, avgPerAuction, totalAuctions, total: filtered.length, range: { start, end } }
        await setCachedBC(cacheKey, result)
        send(controller, { type: "result", data: result })
      } catch (e: any) {
        send(controller, { type: "error", error: e.message ?? "Unknown error" })
      }
      controller.close()
    }
  })

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
}
