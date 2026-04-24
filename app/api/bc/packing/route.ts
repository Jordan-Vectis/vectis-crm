import { NextRequest } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll, bcPage } from "@/lib/bc"

export const maxDuration = 300

function toDateStr(d: Date) { return d.toISOString().split("T")[0] }

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response(JSON.stringify({ error: "Unauthorised" }), { status: 401 })

  const token = await getBCToken()
  if (!token) return new Response(JSON.stringify({ error: "BC_NOT_CONNECTED" }), { status: 401 })

  const { searchParams } = req.nextUrl
  const from = searchParams.get("from") ?? ""
  const to   = searchParams.get("to")   ?? ""
  if (!from || !to) return new Response(JSON.stringify({ error: "Missing from/to" }), { status: 400 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"))
      }

      try {
        const shipments = await bcFetchAll(
          token,
          "ShipmentRequestAPI",
          `EVA_ShipmentDate ge ${from} and EVA_ShipmentDate le ${to}`,
          "EVA_No,EVA_DocumentNo,EVA_ShipmentDate,EVA_Status,PTE_InternalReference"
        )
        const active = shipments.filter((s: any) => s.EVA_Status !== "Cancelled")
        const docNos = [...new Set(active.map((s: any) => s.EVA_DocumentNo).filter(Boolean))] as string[]

        const totalBatches = 1 + Math.ceil(docNos.length / 50)
        send({ type: "progress", done: 1, total: totalBatches })

        const lotByDoc: Record<string, number> = {}
        for (let i = 0; i < docNos.length; i += 50) {
          const batch  = docNos.slice(i, i + 50)
          const quoted = batch.map((v: string) => `EVA_DocumentNo eq '${v}'`).join(" or ")
          const filter = `(${quoted})`
          try {
            const chunk = await bcPage(token, "CollectionList", { $top: 500, $skip: 0, $filter: filter, $select: "EVA_DocumentNo,EVA_NoOfLines" })
            for (const r of chunk) lotByDoc[r.EVA_DocumentNo] = (lotByDoc[r.EVA_DocumentNo] ?? 0) + (Number(r.EVA_NoOfLines) || 0)
          } catch (_) {}
          try {
            const chunk = await bcPage(token, "PostedCollectionList", { $top: 500, $skip: 0, $filter: filter, $select: "EVA_DocumentNo,EVA_NoOfLines" })
            for (const r of chunk) lotByDoc[r.EVA_DocumentNo] = (lotByDoc[r.EVA_DocumentNo] ?? 0) + (Number(r.EVA_NoOfLines) || 0)
          } catch (_) {}
          send({ type: "progress", done: 2 + Math.floor(i / 50), total: totalBatches })
        }

        const entries = active.map((s: any) => ({
          date:     s.EVA_ShipmentDate,
          staff:    (s.PTE_InternalReference ?? "Unknown").trim() || "Unknown",
          docNo:    s.EVA_DocumentNo,
          lotCount: lotByDoc[s.EVA_DocumentNo] ?? 0,
        })).sort((a: any, b: any) => b.date.localeCompare(a.date))

        const staffDay: Record<string, Record<string, number>> = {}
        for (const r of entries) {
          if (!staffDay[r.staff]) staffDay[r.staff] = {}
          staffDay[r.staff][r.date] = (staffDay[r.staff][r.date] ?? 0) + 1
        }
        const dailyAvgCollections = Object.entries(staffDay)
          .map(([staff, days]) => {
            const vals = Object.values(days)
            return { staff, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 }
          })
          .sort((a, b) => b.avg - a.avg)

        const totalCollections = Object.entries(staffDay)
          .map(([staff, days]) => ({ staff, total: Object.values(days).reduce((a, b) => a + b, 0) }))
          .sort((a, b) => b.total - a.total)

        const staffDayLots: Record<string, Record<string, number>> = {}
        for (const r of entries) {
          if (!staffDayLots[r.staff]) staffDayLots[r.staff] = {}
          staffDayLots[r.staff][r.date] = (staffDayLots[r.staff][r.date] ?? 0) + r.lotCount
        }
        const dailyAvgLots = Object.entries(staffDayLots)
          .map(([staff, days]) => {
            const vals = Object.values(days)
            return { staff, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 }
          })
          .sort((a, b) => b.avg - a.avg)

        const lotsByStaff: Record<string, number> = {}
        for (const r of entries) lotsByStaff[r.staff] = (lotsByStaff[r.staff] ?? 0) + r.lotCount
        const totalLots = Object.entries(lotsByStaff)
          .map(([staff, total]) => ({ staff, total }))
          .sort((a, b) => b.total - a.total)

        const staffCount = new Set(entries.map((r: any) => r.staff)).size

        send({
          type: "result",
          data: { dailyAvgCollections, totalCollections, dailyAvgLots, totalLots, raw: entries, meta: { total: entries.length, staffCount } },
        })
      } catch (e: any) {
        send({ type: "error", error: e.message ?? "Unknown error" })
      }
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "X-Content-Type-Options": "nosniff" },
  })
}
