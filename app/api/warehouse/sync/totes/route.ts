import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPageWithNext } from "@/lib/bc"
import { prisma } from "@/lib/prisma"

export const maxDuration = 300

// GET /api/warehouse/sync/totes — probe: returns raw field names + count from Totes_Excel
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })
  const { rows, count } = await bcPageWithNext(token, "Totes_Excel", { $top: 2, "$count": "true" })
  if (!rows.length) return NextResponse.json({ bcCount: count ?? null, fields: [], sample: null })
  return NextResponse.json({ bcCount: count ?? null, fields: Object.keys(rows[0]), sample: rows[0], sample2: rows[1] ?? null })
}

// POST /api/warehouse/sync/totes
//
// Two-pass sync — the client loop drives both passes via nextLink:
//
//   Pass 1 — Totes_Excel:
//     All totes (catalogued + uncatalogued) with basic location data.
//     Uses EVA_No as the tote identifier.
//     When BC has no more pages, server returns nextLink="PASS2" and more=true.
//
//   Pass 2 — Receipt_Totes_Excel:
//     Active (uncatalogued) totes only with richer data (vendor, reserve status).
//     Uses EVA_TOT_ToteNo as the tote identifier.
//     Upserts enrich/overwrite Pass 1 data for any matching totes.
//     When complete, returns more=false.
//
// On full re-sync the table is cleared before Pass 1 begins.
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

  // Determine which pass we're in from the nextLink sentinel
  const isPass2 = nextLink === "PASS2" || nextLink?.startsWith("PASS2:")
  const pass2NextLink = isPass2
    ? (nextLink === "PASS2" ? null : nextLink!.slice(6))
    : null

  // Clear the table at the start of a full re-sync (before Pass 1 only)
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

    if (isPass2) {
      // Pass 2: Receipt_Totes_Excel — active totes with richer detail
      urlOrEndpoint = pass2NextLink ?? "Receipt_Totes_Excel"
      initialParams = pass2NextLink ? undefined : { $orderby: "SystemCreatedAt asc" }
    } else if (nextLink) {
      // Pass 1 continuation via BC nextLink
      urlOrEndpoint = nextLink
      initialParams = undefined
    } else {
      // Pass 1 start: totes from Totes_Excel (T-prefixed numbers only — other records are bins/containers)
      urlOrEndpoint = "Totes_Excel"
      initialParams = { $filter: "startswith(EVA_No,'T') or startswith(EVA_No,'P')", $orderby: "EVA_No asc" }
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

      if (isPass2) {
        // Pass 2: Receipt_Totes_Excel fields
        for (const r of rows) {
          const toteNo = String(r.EVA_TOT_ToteNo ?? "").trim()
          if (!toteNo) continue
          upserts.push(prisma.warehouseTote.upsert({
            where:  { toteNo },
            update: {
              location:   String(r.EVA_TOT_ToteLocation ?? "").trim() || null,
              receiptNo:  r.EVA_TOT_ReceiptNo  ?? null,
              vendorNo:   r.EVA_TOT_VendorNo   ?? null,
              vendorName: r.EVA_TOT_VendorName ?? null,
              status:     r.EVA_TOT_ReserveStatus ?? null,
              catalogued: r.EVA_TOT_Catalogued === true || r.EVA_TOT_Catalogued === 1,
              syncedAt:   new Date(),
            },
            create: {
              toteNo,
              location:   String(r.EVA_TOT_ToteLocation ?? "").trim() || null,
              receiptNo:  r.EVA_TOT_ReceiptNo  ?? null,
              vendorNo:   r.EVA_TOT_VendorNo   ?? null,
              vendorName: r.EVA_TOT_VendorName ?? null,
              status:     r.EVA_TOT_ReserveStatus ?? null,
              catalogued: r.EVA_TOT_Catalogued === true || r.EVA_TOT_Catalogued === 1,
            },
          }))
        }
      } else {
        // Pass 1: Totes_Excel fields
        for (const r of rows) {
          const toteNo = String(r.EVA_No ?? "").trim()
          if (!toteNo) continue
          upserts.push(prisma.warehouseTote.upsert({
            where:  { toteNo },
            update: {
              location: String(r.EVA_Location ?? "").trim() || null,
              syncedAt: new Date(),
            },
            create: {
              toteNo,
              location: String(r.EVA_Location ?? "").trim() || null,
            },
          }))
        }
      }

      for (let i = 0; i < upserts.length; i += CHUNK) {
        await Promise.all(upserts.slice(i, i + CHUNK))
      }
      itemsProcessed += upserts.length

      if (!nl) break
    }

    // Pass 1 finished — signal client to start Pass 2
    if (!isPass2 && !currentLink) {
      await prisma.warehouseSyncLog.update({
        where: { id: syncLog.id },
        data: { status: "complete", completedAt: new Date(), itemsProcessed },
      })
      return NextResponse.json({
        ok: true, itemsProcessed, more: true, nextLink: "PASS2", full, pages: pageCount,
      })
    }

    // Pass 1 timed out / hit maxItems — continue with BC nextLink
    if (!isPass2 && currentLink) {
      await prisma.warehouseSyncLog.update({
        where: { id: syncLog.id },
        data: { status: "complete", completedAt: new Date(), itemsProcessed },
      })
      return NextResponse.json({
        ok: true, itemsProcessed, more: true, nextLink: currentLink, full, pages: pageCount,
      })
    }

    // Pass 2 timed out / hit maxItems — continue with Pass 2 nextLink
    if (isPass2 && currentLink) {
      await prisma.warehouseSyncLog.update({
        where: { id: syncLog.id },
        data: { status: "complete", completedAt: new Date(), itemsProcessed },
      })
      return NextResponse.json({
        ok: true, itemsProcessed, more: true, nextLink: `PASS2:${currentLink}`, full, pages: pageCount,
      })
    }

    // Pass 2 complete — all done
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "complete", completedAt: new Date(), itemsProcessed },
    })
    return NextResponse.json({
      ok: true, itemsProcessed, more: false, nextLink: null, full, pages: pageCount,
    })

  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed },
    })
    return NextResponse.json({ error: e.message, itemsProcessed }, { status: 500 })
  }
}
