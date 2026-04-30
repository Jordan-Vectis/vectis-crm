import { NextRequest, NextResponse } from "next/server"
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

function parseFloat_(v: any): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = parseFloat(String(v))
  return isNaN(n) ? null : n
}

// POST /api/warehouse/sync/receipt-lines
// Incrementally syncs Receipt_Lines_Excel into WarehouseItem.
// Accepts optional body: { maxPages?: number } to cap pages per call (default 50).
// Returns { more: true } when there are additional pages to fetch — caller should
// keep calling until more === false to handle very large initial syncs.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  let maxPages = 5   // 5 pages × 500 = 2,500 items per call — well under Railway's 60s timeout
  try { const body = await req.json(); if (body?.maxPages) maxPages = body.maxPages } catch {}

  // Find last successful sync to determine start point
  const lastSync = await prisma.warehouseSyncLog.findFirst({
    where: { source: "receipt_lines", status: "complete" },
    orderBy: { completedAt: "desc" },
  })

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "receipt_lines", status: "running" },
  })

  let itemsProcessed = 0
  let lastTimestamp  = lastSync?.lastTimestamp ?? null

  try {
    const BATCH = 500
    let page  = 0
    let done  = false
    let more  = false
    let newestTimestamp = lastTimestamp

    while (!done) {
      if (page >= maxPages) { more = true; break }
      const params: Record<string, any> = {
        $top:     BATCH,
        $skip:    page * BATCH,
        $orderby: "EVA_SystemModifiedAt asc",
      }

      // Incremental — only fetch records modified since last sync
      if (lastTimestamp) {
        params.$filter = `EVA_SystemModifiedAt gt datetime'${lastTimestamp}'`
      }

      let rows: any[]
      try {
        rows = await bcPage(token, "Receipt_Lines_Excel", params)
      } catch { break }

      if (rows.length === 0) break

      // Upsert each row into WarehouseItem
      for (const r of rows) {
        const uniqueId = String(r.EVA_UniqueID ?? "").trim()
        if (!uniqueId) continue

        await prisma.warehouseItem.upsert({
          where:  { uniqueId },
          update: {
            receiptNo:        r.EVA_ReceiptNo        ?? null,
            articleNo:        r.EVA_ArticleNo != null ? String(r.EVA_ArticleNo) : null,
            stockNo:          r.EVA_StockNo          ?? null,
            barcode:          r.PTE_InternalBarcode  ?? null,
            description:      r.EVA_ShortDescription ?? null,
            artist:           r.EVA_Artist           ?? null,
            category:         r.EVA_ArticleCategoryCode    ?? null,
            subcategory:      r.EVA_ArticleSubcategoryCode ?? null,
            vendorNo:         r.EVA_VendorNo         ?? null,
            vendorName:       r.EVA_VendorName       ?? null,
            auctionCode:      r.EVA_SalesAllocation  ?? null,
            auctionDate:      r.EVA_AuctionDate      ?? null,
            lotNo:            r.EVA_LotNo != null ? String(r.EVA_LotNo) : null,
            lowEstimate:      parseFloat_(r.EVA_LowEstimate),
            highEstimate:     parseFloat_(r.EVA_HighEstimate),
            hammerPrice:      parseFloat_(r.EVA_HammerPrice),
            reservePrice:     parseFloat_(r.EVA_ReservePrice),
            location:         r.EVA_ArticleLocationCode ?? null,
            binCode:          r.EVA_ArticleBinCode      ?? null,
            toteNo:           r.EVA_ArticleToteNo       ?? null,
            catalogued:       parseBool(r.EVA_Catalogued),
            cataloguedBy:     r.EVA_CataloguedBy        ?? null,
            cataloguedAt:     parseDate(r.EVA_CataloguedDateTime),
            noOfPhotos:       r.EVA_NoOfPhotos != null ? parseInt(r.EVA_NoOfPhotos) : null,
            goodsReceived:    parseBool(r.EVA_GoodsReceived),
            goodsReceivedDate: parseDate(r.EVA_GoodsReceivedDate),
            collected:        parseBool(r.EVA_Collected),
            bcModifiedAt:     parseDate(r.EVA_SystemModifiedAt),
          },
          create: {
            uniqueId,
            receiptNo:        r.EVA_ReceiptNo        ?? null,
            articleNo:        r.EVA_ArticleNo != null ? String(r.EVA_ArticleNo) : null,
            stockNo:          r.EVA_StockNo          ?? null,
            barcode:          r.PTE_InternalBarcode  ?? null,
            description:      r.EVA_ShortDescription ?? null,
            artist:           r.EVA_Artist           ?? null,
            category:         r.EVA_ArticleCategoryCode    ?? null,
            subcategory:      r.EVA_ArticleSubcategoryCode ?? null,
            vendorNo:         r.EVA_VendorNo         ?? null,
            vendorName:       r.EVA_VendorName       ?? null,
            auctionCode:      r.EVA_SalesAllocation  ?? null,
            auctionDate:      r.EVA_AuctionDate      ?? null,
            lotNo:            r.EVA_LotNo != null ? String(r.EVA_LotNo) : null,
            lowEstimate:      parseFloat_(r.EVA_LowEstimate),
            highEstimate:     parseFloat_(r.EVA_HighEstimate),
            hammerPrice:      parseFloat_(r.EVA_HammerPrice),
            reservePrice:     parseFloat_(r.EVA_ReservePrice),
            location:         r.EVA_ArticleLocationCode ?? null,
            binCode:          r.EVA_ArticleBinCode      ?? null,
            toteNo:           r.EVA_ArticleToteNo       ?? null,
            catalogued:       parseBool(r.EVA_Catalogued),
            cataloguedBy:     r.EVA_CataloguedBy        ?? null,
            cataloguedAt:     parseDate(r.EVA_CataloguedDateTime),
            noOfPhotos:       r.EVA_NoOfPhotos != null ? parseInt(r.EVA_NoOfPhotos) : null,
            goodsReceived:    parseBool(r.EVA_GoodsReceived),
            goodsReceivedDate: parseDate(r.EVA_GoodsReceivedDate),
            collected:        parseBool(r.EVA_Collected),
            bcModifiedAt:     parseDate(r.EVA_SystemModifiedAt),
          },
        })

        itemsProcessed++
        if (r.EVA_SystemModifiedAt) newestTimestamp = r.EVA_SystemModifiedAt
      }

      if (rows.length < BATCH) { done = true } else { page++ }
    }

    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status:         "complete",
        completedAt:    new Date(),
        itemsProcessed,
        lastTimestamp:  newestTimestamp,
      },
    })

    return NextResponse.json({ ok: true, itemsProcessed, incremental: !!lastTimestamp, more })
  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed },
    })
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
