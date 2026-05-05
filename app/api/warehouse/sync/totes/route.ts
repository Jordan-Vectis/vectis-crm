import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

function parseDate(v: any): Date | null {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// Pull a tote number from the row defensively — BC field names vary by tenant
function pickToteNo(r: any): string | null {
  const candidates = [
    r.EVA_ToteNo, r.EVA_ArticleToteNo, r.EVA_TOT_ToteNo,
    r.EVA_TOT_No, r.ToteNo, r.No, r.EVA_TOT_RecordNo,
  ]
  for (const c of candidates) {
    if (c == null) continue
    const s = String(c).trim()
    if (s) return s
  }
  return null
}

// POST /api/warehouse/sync/totes
// Same nextLink-based pattern as receipt-lines. Pulls Receipt_Totes_Excel and
// upserts into WarehouseTote so totes can be counted on the heatmap even when
// no individual items are scanned in yet.
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  let full = false
  let nextLink: string | null = null
  let maxItems = 5000
  try {
    const body = await req.json()
    if (body?.full)     full     = !!body.full
    if (body?.nextLink) nextLink = String(body.nextLink)
    if (body?.maxItems) maxItems = body.maxItems
  } catch {}

  const lastSync = (full || nextLink) ? null : await prisma.warehouseSyncLog.findFirst({
    where: { source: "totes", status: "complete" },
    orderBy: { completedAt: "desc" },
  })
  const lastTimestamp = lastSync?.lastTimestamp ?? null

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "totes", status: "running" },
  })

  let itemsProcessed = 0
  let newestTimestamp = lastTimestamp
  const startMs = Date.now()

  try {
    let urlOrEndpoint: string
    let initialParams: Record<string, string | number> | undefined

    if (nextLink) {
      urlOrEndpoint = nextLink
      initialParams = undefined
    } else {
      urlOrEndpoint = "Receipt_Totes_Excel"
      initialParams = { $orderby: "EVA_SystemModifiedAt asc" }
      if (lastTimestamp) {
        initialParams.$filter = `EVA_SystemModifiedAt ge ${lastTimestamp}`
      }
    }

    let currentLink: string | null = null
    let pageCount = 0

    while (true) {
      if (Date.now() - startMs > 50_000) break
      if (itemsProcessed >= maxItems) break

      const { rows, nextLink: nl } = await bcPageWithNext(
        token,
        currentLink ?? urlOrEndpoint,
        currentLink ? undefined : initialParams,
      )

      pageCount++
      currentLink = nl

      if (rows.length === 0) break

      const CHUNK = 20
      const upserts: Promise<any>[] = []
      const validRows = rows.filter(r => pickToteNo(r))
      for (const r of validRows) {
        const toteNo = pickToteNo(r)!
        upserts.push(prisma.warehouseTote.upsert({
          where:  { toteNo },
          update: {
            location:     r.EVA_ArticleLocationCode ?? r.EVA_TOT_Location ?? r.Location ?? null,
            binCode:      r.EVA_ArticleBinCode      ?? r.EVA_TOT_BinCode  ?? null,
            receiptNo:    r.EVA_ReceiptNo           ?? null,
            vendorNo:     r.EVA_VendorNo            ?? null,
            vendorName:   r.EVA_VendorName          ?? null,
            status:       r.EVA_Status ?? r.Status ?? null,
            bcModifiedAt: parseDate(r.EVA_SystemModifiedAt),
            syncedAt:     new Date(),
          },
          create: {
            toteNo,
            location:     r.EVA_ArticleLocationCode ?? r.EVA_TOT_Location ?? r.Location ?? null,
            binCode:      r.EVA_ArticleBinCode      ?? r.EVA_TOT_BinCode  ?? null,
            receiptNo:    r.EVA_ReceiptNo           ?? null,
            vendorNo:     r.EVA_VendorNo            ?? null,
            vendorName:   r.EVA_VendorName          ?? null,
            status:       r.EVA_Status ?? r.Status ?? null,
            bcModifiedAt: parseDate(r.EVA_SystemModifiedAt),
          },
        }))
        if (r.EVA_SystemModifiedAt) newestTimestamp = r.EVA_SystemModifiedAt
      }

      for (let i = 0; i < upserts.length; i += CHUNK) {
        await Promise.all(upserts.slice(i, i + CHUNK))
      }
      itemsProcessed += validRows.length

      if (!nl) break
    }

    const more = !!currentLink

    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: {
        status:         "complete",
        completedAt:    new Date(),
        itemsProcessed,
        lastTimestamp:  newestTimestamp,
      },
    })

    return NextResponse.json({
      ok:           true,
      itemsProcessed,
      incremental:  !full && !!lastTimestamp,
      more,
      nextLink:     currentLink,
      full,
      pages:        pageCount,
    })
  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed },
    })
    return NextResponse.json({ error: e.message, itemsProcessed }, { status: 500 })
  }
}
