import { NextRequest } from "next/server"
import { getBCTokenAny, bcFetchAll, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

function toDateStr(d: Date) { return d.toISOString().split("T")[0] }
function addDays(date: Date, n: number) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + n); return d }

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 })
  }

  const token = await getBCTokenAny()
  if (!token) return Response.json({ error: "No BC token available" }, { status: 503 })

  const today = toDateStr(new Date())
  const allPastDates = [
    toDateStr(addDays(new Date(), -3)),
    toDateStr(addDays(new Date(), -2)),
    toDateStr(addDays(new Date(), -1)),
  ].filter(dt => dt < today)

  const cached = await prisma.bCPackingDay.findMany({
    where: { date: { in: allPastDates } },
    select: { date: true },
  })
  const cachedSet = new Set(cached.map(r => r.date))
  const toFetch = allPastDates.filter(dt => !cachedSet.has(dt))

  if (toFetch.length === 0) {
    return Response.json({ ok: true, message: "All dates already cached" })
  }

  const from = toFetch[0]
  const to   = toFetch[toFetch.length - 1]
  const toFetchSet = new Set(toFetch)

  const shipments = await bcFetchAll(
    token,
    "ShipmentRequestAPI",
    `EVA_ShipmentDate ge ${from} and EVA_ShipmentDate le ${to}`,
    "EVA_No,EVA_DocumentNo,EVA_ShipmentDate,EVA_Status,PTE_InternalReference"
  )
  const active = shipments.filter(s => s.EVA_Status !== "Cancelled" && toFetchSet.has(s.EVA_ShipmentDate))
  const docNos = [...new Set(active.map((s: any) => s.EVA_DocumentNo).filter(Boolean))]

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
  }

  const entries = active.map((s: any) => ({
    date:     s.EVA_ShipmentDate,
    staff:    (s.PTE_InternalReference ?? "Unknown").trim() || "Unknown",
    docNo:    s.EVA_DocumentNo,
    lotCount: lotByDoc[s.EVA_DocumentNo] ?? 0,
  }))

  await Promise.all([
    ...entries.map((e: any) =>
      prisma.bCPackingEntry.upsert({
        where:  { date_staff_docNo: { date: e.date, staff: e.staff, docNo: e.docNo } },
        create: e,
        update: { lotCount: e.lotCount },
      })
    ),
    ...toFetch.map(date =>
      prisma.bCPackingDay.upsert({
        where:  { date },
        create: { date },
        update: { fetchedAt: new Date() },
      })
    ),
  ])

  console.log(`[cron/bc-packing] Cached ${toFetch.length} dates, ${entries.length} entries`)
  return Response.json({ ok: true, datesCached: toFetch.length, entriesStored: entries.length })
}
