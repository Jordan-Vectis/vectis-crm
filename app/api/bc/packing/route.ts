import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCTokenFromCookie, bcFetchAll, bcPage } from "@/lib/bc"

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCTokenFromCookie()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

  const { searchParams } = req.nextUrl
  const from = searchParams.get("from") ?? ""
  const to   = searchParams.get("to")   ?? ""
  if (!from || !to) return NextResponse.json({ error: "Missing from/to" }, { status: 400 })

  const shipFilter =
    `EVA_ShipmentDate ge ${from} and EVA_ShipmentDate le ${to}`

  // Fetch shipments
  const shipments = await bcFetchAll(
    token,
    "ShipmentRequestAPI",
    shipFilter,
    "EVA_No,EVA_DocumentNo,EVA_ShipmentDate,EVA_Status,PTE_InternalReference"
  )
  const active = shipments.filter((s) => s.EVA_Status !== "Cancelled")
  const docNos = [...new Set(active.map((s) => s.EVA_DocumentNo).filter(Boolean))]

  // Fetch collection lot counts in batches of 50
  const colRows: any[] = []
  for (let i = 0; i < docNos.length; i += 50) {
    const batch   = docNos.slice(i, i + 50)
    const quoted  = batch.map((v) => `EVA_DocumentNo eq '${v}'`).join(" or ")
    const filter  = `(${quoted})`
    const select  = "EVA_DocumentNo,EVA_NoOfLines"
    try {
      const chunk = await bcPage(token, "CollectionList", { $top: 500, $skip: 0, $filter: filter, $select: select })
      colRows.push(...chunk)
    } catch (_) {}
    try {
      const chunk = await bcPage(token, "PostedCollectionList", { $top: 500, $skip: 0, $filter: filter, $select: select })
      colRows.push(...chunk)
    } catch (_) {}
  }

  // Sum lot counts per document
  const lotByDoc: Record<string, number> = {}
  for (const r of colRows) {
    lotByDoc[r.EVA_DocumentNo] = (lotByDoc[r.EVA_DocumentNo] ?? 0) + (Number(r.EVA_NoOfLines) || 0)
  }

  // Merge
  const merged = active.map((s) => ({
    date:     s.EVA_ShipmentDate,
    staff:    (s.PTE_InternalReference ?? "Unknown").trim() || "Unknown",
    docNo:    s.EVA_DocumentNo,
    lotCount: lotByDoc[s.EVA_DocumentNo] ?? 0,
  }))

  // --- Daily avg collections per staff ---
  const staffDay: Record<string, Record<string, number>> = {}
  for (const r of merged) {
    if (!staffDay[r.staff]) staffDay[r.staff] = {}
    staffDay[r.staff][r.date] = (staffDay[r.staff][r.date] ?? 0) + 1
  }
  const dailyAvgCollections = Object.entries(staffDay)
    .map(([staff, days]) => {
      const vals = Object.values(days)
      return { staff, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 }
    })
    .sort((a, b) => b.avg - a.avg)

  // --- Total collections per staff ---
  const totalCollections = Object.entries(staffDay)
    .map(([staff, days]) => ({ staff, total: Object.values(days).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)

  // --- Daily avg lots per staff ---
  const staffDayLots: Record<string, Record<string, number>> = {}
  for (const r of merged) {
    if (!staffDayLots[r.staff]) staffDayLots[r.staff] = {}
    staffDayLots[r.staff][r.date] = (staffDayLots[r.staff][r.date] ?? 0) + r.lotCount
  }
  const dailyAvgLots = Object.entries(staffDayLots)
    .map(([staff, days]) => {
      const vals = Object.values(days)
      return { staff, avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 }
    })
    .sort((a, b) => b.avg - a.avg)

  // --- Total lots per staff ---
  const lotsByStaff: Record<string, number> = {}
  for (const r of merged) {
    lotsByStaff[r.staff] = (lotsByStaff[r.staff] ?? 0) + r.lotCount
  }
  const totalLots = Object.entries(lotsByStaff)
    .map(([staff, total]) => ({ staff, total }))
    .sort((a, b) => b.total - a.total)

  const staffCount = new Set(merged.map((r) => r.staff)).size

  return NextResponse.json({
    dailyAvgCollections,
    totalCollections,
    dailyAvgLots,
    totalLots,
    raw: merged.sort((a, b) => b.date.localeCompare(a.date)),
    meta: { total: merged.length, staffCount },
  })
}
