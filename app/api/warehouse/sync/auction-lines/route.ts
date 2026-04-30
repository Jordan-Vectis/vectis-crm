import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPage } from "@/lib/bc"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

function parseDate(v: any): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function parseBool(v: any): boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === "boolean") return v
  if (v === "true" || v === "Yes" || v === 1) return true
  if (v === "false" || v === "No" || v === 0) return false
  return null
}

// POST /api/warehouse/sync/auction-lines
// Supplements WarehouseItem with EVA_CurrentLotNo and EVA_VendorEmail
// from Auction_Receipt_Lines_Excel, matched by EVA_UniqueID.
export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  const lastSync = await prisma.warehouseSyncLog.findFirst({
    where: { source: "auction_lines", status: "complete" },
    orderBy: { completedAt: "desc" },
  })

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "auction_lines", status: "running" },
  })

  let itemsProcessed = 0
  let lastTimestamp  = lastSync?.lastTimestamp ?? null
  let newestTimestamp = lastTimestamp

  try {
    const BATCH = 500
    let page = 0
    let done = false

    while (!done) {
      const params: Record<string, any> = {
        $top:     BATCH,
        $skip:    page * BATCH,
        $orderby: "EVA_SystemModifiedAt asc",
      }

      if (lastTimestamp) {
        params.$filter = `EVA_SystemModifiedAt gt datetime'${lastTimestamp}'`
      }

      let rows: any[]
      try {
        rows = await bcPage(token, "Auction_Receipt_Lines_Excel", params)
      } catch { break }

      if (rows.length === 0) break

      for (const r of rows) {
        const uniqueId = String(r.EVA_UniqueID ?? "").trim()
        if (!uniqueId) continue

        // Only update fields that auction lines adds — don't overwrite receipt lines data
        await prisma.warehouseItem.upsert({
          where:  { uniqueId },
          update: {
            currentLotNo: r.EVA_CurrentLotNo != null ? String(r.EVA_CurrentLotNo) : null,
            vendorEmail:  r.EVA_VendorEmail  ?? null,
            withdrawLot:  parseBool(r.EVA_WithdrawLot),
          },
          create: {
            uniqueId,
            currentLotNo: r.EVA_CurrentLotNo != null ? String(r.EVA_CurrentLotNo) : null,
            vendorEmail:  r.EVA_VendorEmail  ?? null,
            withdrawLot:  parseBool(r.EVA_WithdrawLot),
            // Also bring in location in case this item isn't in receipt lines yet
            location:     r.EVA_ArticleLocationCode ?? null,
            binCode:      r.EVA_ArticleBinCode      ?? null,
            toteNo:       r.EVA_ArticleToteNo       ?? null,
            auctionCode:  r.EVA_SalesAllocation     ?? null,
            description:  r.EVA_ShortDescription    ?? null,
            vendorNo:     r.EVA_VendorNo             ?? null,
            vendorName:   r.EVA_VendorName           ?? null,
            bcModifiedAt: r.EVA_SystemModifiedAt ? new Date(r.EVA_SystemModifiedAt) : null,
          },
        })

        itemsProcessed++
        if (r.EVA_SystemModifiedAt) newestTimestamp = r.EVA_SystemModifiedAt
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
