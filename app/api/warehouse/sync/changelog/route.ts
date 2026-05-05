import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

// POST /api/warehouse/sync/changelog
// Incrementally reads ChangeLogEntries for Article Location Code changes,
// updating locationScannedAt on matching WarehouseItems.
// Always incremental — only fetches entries newer than last sync.
export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  const lastSync = await prisma.warehouseSyncLog.findFirst({
    where: { source: "changelog", status: "complete" },
    orderBy: { completedAt: "desc" },
  })

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "changelog", status: "running" },
  })

  let itemsProcessed = 0
  const lastTimestamp = lastSync?.lastTimestamp ?? null
  let newestTimestamp = lastTimestamp

  try {
    const BATCH = 500
    let page = 0
    let done = false

    while (!done) {
      const filterParts = [`Field_Caption eq 'Article Location Code'`]
      if (lastTimestamp) {
        // OData v4 — bare ISO 8601 literal, no datetime'...' wrapper (that's v3)
        filterParts.push(`Date_and_Time ge ${lastTimestamp}`)
      }

      let rows: any[]
      try {
        rows = await bcPage(token, "ChangeLogEntries", {
          $filter:  filterParts.join(" and "),
          $select:  "Primary_Key_Field_2_Value,New_Value,Date_and_Time",
          $orderby: "Date_and_Time asc",
          $top:     BATCH,
          $skip:    page * BATCH,
        })
      } catch { break }

      if (rows.length === 0) break

      for (const r of rows) {
        const uniqueId = String(r.Primary_Key_Field_2_Value ?? "").trim()
        const scannedAt = r.Date_and_Time ? new Date(r.Date_and_Time) : null
        if (!uniqueId || !scannedAt) continue

        // Update locationScannedAt if this entry is newer than what we have
        await prisma.warehouseItem.updateMany({
          where: {
            uniqueId,
            OR: [
              { locationScannedAt: null },
              { locationScannedAt: { lt: scannedAt } },
            ],
          },
          data: { locationScannedAt: scannedAt },
        })

        itemsProcessed++
        if (r.Date_and_Time) newestTimestamp = r.Date_and_Time
      }

      if (rows.length < BATCH) { done = true } else { page++ }
    }

    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "complete", completedAt: new Date(), itemsProcessed, lastTimestamp: newestTimestamp },
    })

    return NextResponse.json({ ok: true, itemsProcessed, incremental: !!lastTimestamp })
  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed },
    })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
