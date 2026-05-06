import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

// GET /api/warehouse/sync/totes — probe: returns raw field names + first 2 rows from BC
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })
  const { rows } = await bcPageWithNext(token, "Receipt_Totes_Excel", { $top: 2 })
  if (!rows.length) return NextResponse.json({ fields: [], sample: null })
  return NextResponse.json({ fields: Object.keys(rows[0]), sample: rows[0], sample2: rows[1] ?? null })
}

// POST /api/warehouse/sync/totes
// Pulls Receipt_Totes_Excel (only uncatalogued / active totes) and upserts into
// WarehouseTote so totes appear on the heatmap even before items are scanned in.
// On full re-sync the table is cleared first so stale completed totes don't linger.
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

  // On the first batch of a full re-sync, clear the table so completed totes don't linger
  if (full && !nextLink) {
    await prisma.warehouseTote.deleteMany({})
  }

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "totes", status: "running" },
  })

  let itemsProcessed = 0
  const startMs = Date.now()

  try {
    let urlOrEndpoint: string
    let initialParams: Record<string, string> | undefined

    if (nextLink) {
      urlOrEndpoint = nextLink
      initialParams = undefined
    } else {
      // Only sync active (uncatalogued) totes — completed ones are filtered out.
      // Receipt_Totes_Excel has no SystemModifiedAt field so we always pull the full set.
      urlOrEndpoint = "Receipt_Totes_Excel"
      initialParams = { $filter: "EVA_TOT_Catalogued eq false" }
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

      for (const r of rows) {
        const toteNo = String(r.EVA_TOT_ToteNo ?? "").trim()
        if (!toteNo) continue

        upserts.push(prisma.warehouseTote.upsert({
          where:  { toteNo },
          update: {
            location:   (r.EVA_TOT_ToteLocation  != null ? String(r.EVA_TOT_ToteLocation).trim()  : null) || null,
            receiptNo:  r.EVA_TOT_ReceiptNo  ?? null,
            vendorNo:   r.EVA_TOT_VendorNo   ?? null,
            vendorName: r.EVA_TOT_VendorName ?? null,
            status:     r.EVA_TOT_ReserveStatus ?? null,
            catalogued: r.EVA_TOT_Catalogued === true || r.EVA_TOT_Catalogued === 1,
            syncedAt:   new Date(),
          },
          create: {
            toteNo,
            location:   (r.EVA_TOT_ToteLocation  != null ? String(r.EVA_TOT_ToteLocation).trim()  : null) || null,
            receiptNo:  r.EVA_TOT_ReceiptNo  ?? null,
            vendorNo:   r.EVA_TOT_VendorNo   ?? null,
            vendorName: r.EVA_TOT_VendorName ?? null,
            status:     r.EVA_TOT_ReserveStatus ?? null,
            catalogued: r.EVA_TOT_Catalogued === true || r.EVA_TOT_Catalogued === 1,
          },
        }))
      }

      for (let i = 0; i < upserts.length; i += CHUNK) {
        await Promise.all(upserts.slice(i, i + CHUNK))
      }
      itemsProcessed += upserts.length

      if (!nl) break
    }

    const more = !!currentLink

    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "complete", completedAt: new Date(), itemsProcessed },
    })

    return NextResponse.json({ ok: true, itemsProcessed, incremental: false, more, nextLink: currentLink, full, pages: pageCount })
  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed },
    })
    return NextResponse.json({ error: e.message, itemsProcessed }, { status: 500 })
  }
}
