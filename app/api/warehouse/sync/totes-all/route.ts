import { NextRequest, NextResponse } from "next/server"
import { getBCTokenAny, bcPageWithNext, bcTotApiUrl, pickBcContents } from "@/lib/bc"
import { prisma } from "@/lib/prisma"
import { isAuthedOrCron } from "@/lib/auth-or-cron"

export const maxDuration = 300

// ⚠ Business Central sends an EMPTY date as "0001-01-01T00:00:00Z", which parses
// into a perfectly valid Date in year 1. Anything before 1990 is BC's way of
// saying "no date" — same guard as sync/totes-active and receipt-lines.
function bcDate(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  if (isNaN(d.getTime())) return null
  return d.getUTCFullYear() < 1990 ? null : d
}

// POST /api/warehouse/sync/totes-all
// Syncs the FULL receipt-tote list — catalogued totes included — from the
// eva/tot custom API (page 76804, bound to EVA_TOT_ReceiptTote with no filter).
//
// Why this exists (2026-08-06): sync/totes-active reads Receipt_Totes_Excel,
// which only publishes totes NOT ticked Catalogued (~1,800 of ~20,500 rows).
// Any tote catalogued before its enrichment was captured stayed a bare shell
// (receiptNo/vendor/catalogued all null), which made End of Day flag real BC
// receipts as "Receipt doesn't exist in BC". This route fills receiptNo /
// vendorNo / catalogued / bcCreatedAt for EVERY receipt-linked tote.
//
// Deliberately NOT written here:
//   • vendorName — the API page has no vendor-name field. sync/totes-active
//     still writes it for active totes; when the walk completes, a set-based
//     backfill below copies names from WarehouseItem by vendorNo for the rest.
//   • status — the API returns raw enum names ("EVA_NoReserve") where the
//     Excel feed returns captions ("No Reserve"); writing both formats into
//     one column would corrupt it. totes-active remains the only status writer.
// Same no-wipe rule as the other tote syncs: upsert only, never deleteMany.
export async function POST(req: NextRequest) {
  if (!await isAuthedOrCron(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCTokenAny()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  let nextLink: string | null = null
  let maxItems = 5000
  try {
    const body = await req.json()
    if (body?.nextLink) nextLink = String(body.nextLink)
    if (body?.maxItems) maxItems = body.maxItems
  } catch {}

  const syncLog = await prisma.warehouseSyncLog.create({
    data: { source: "totes-all", status: "running" },
  })

  let itemsProcessed = 0
  const startMs = Date.now()

  // Same deploy-before-migration guard as totes-active: never write a column
  // that isn't there yet, or every upsert fails and takes the sync down.
  let hasBcCreatedAt = false
  try {
    const [row] = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WarehouseTote' AND column_name = 'bcCreatedAt'
      ) AS "exists"`
    hasBcCreatedAt = !!row?.exists
  } catch { hasBcCreatedAt = false }

  // ⚠ Same deploy-before-migration guard for the NEW receipt-tote table (2026-09-08). Writing to
  // a table that is not there yet would throw inside the batch and take the WHOLE tote sync down —
  // exactly the failure the bcCreatedAt guard above exists to prevent. Absent table = we simply
  // skip it and everything behaves as it did before.
  let hasReceiptTotes = false
  try {
    const [row] = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'WarehouseReceiptTote'
      ) AS "exists"`
    hasReceiptTotes = !!row?.exists
  } catch { hasReceiptTotes = false }

  // Same guard for the category columns (added 2026-08-18 for the Admin Centre's totes table).
  let hasCategory = false
  try {
    const [row] = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WarehouseTote' AND column_name = 'category'
      ) AS "exists"`
    hasCategory = !!row?.exists
  } catch { hasCategory = false }

  // Same guard for BC's free-text tote contents (added 2026-09-09 for the lot wizard).
  let hasContents = false
  try {
    const [row] = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WarehouseTote' AND column_name = 'contents'
      ) AS "exists"`
    hasContents = !!row?.exists
  } catch { hasContents = false }

  // Which property this feed carries the contents description on — reported to the Data Sync
  // screen so "nothing showed up" can be told apart from "this feed doesn't publish it".
  let contentsField: string | null = null

  try {
    const startUrl: string = nextLink ?? await bcTotApiUrl(token, "receiptTotes")

    let currentLink: string | null = null
    let pageCount = 0

    while (true) {
      if (Date.now() - startMs > 25_000) break
      if (itemsProcessed >= maxItems) break

      const { rows, nextLink: nl } = await bcPageWithNext(
        token,
        currentLink ?? startUrl,
      )

      pageCount++
      currentLink = nl
      if (rows.length === 0) break

      const upserts: Promise<any>[] = []
      // ⚠ Count TOTE ROWS, not database writes. Each row now produces up to two upserts (the
      // tote-keyed cache and BC's receipt-tote row), and counting the writes would double the
      // figure on the Data Sync screen and halve how much each pass gets through before the
      // maxItems budget stops it.
      let rowsSeen = 0
      for (const r of rows) {
        const toteNo = String(r.toteNo ?? "").trim()
        if (!toteNo) continue
        rowsSeen++
        const location = String(r.toteLocation ?? "").trim()
        const created  = bcDate(r.systemCreatedAt)
        // ⚠ Field names confirmed against a live receiptTotes row, not guessed:
        // articleCategory / articleSubcategory (both can be an empty string).
        const category    = String(r.articleCategory    ?? "").trim()
        const subCategory = String(r.articleSubcategory ?? "").trim()
        // ⚠ Spelling discovered from the row, not assumed — see pickBcContents in lib/bc.ts.
        const contents    = pickBcContents(r as Record<string, unknown>)
        if (contents.field && !contentsField) contentsField = contents.field
        const common = {
          receiptNo:  r.receiptNo ?? null,
          vendorNo:   r.vendorNo  ?? null,
          catalogued: r.catalogued === true,
          // Don't null out values another sync already captured
          ...(location ? { location } : {}),
          ...(hasBcCreatedAt && created ? { bcCreatedAt: created } : {}),
          ...(hasCategory && category    ? { category }    : {}),
          ...(hasCategory && subCategory ? { subCategory } : {}),
          ...(hasContents && contents.value ? { contents: contents.value } : {}),
        }
        upserts.push(prisma.warehouseTote.upsert({
          where:  { toteNo },
          update: { ...common, syncedAt: new Date() },
          create: { toteNo, ...common },
        }))

        // ⚠⚠ AND the row as BC actually holds it — one per (receipt, tote), not one per tote.
        // The upsert above is unique on toteNo, so when a tote is on several receipts it keeps
        // only the last one written and the wizard gets a single confident answer to a question
        // with two answers. This keeps them all. Nothing that exists today reads this table; it
        // feeds the wizard's lookups only (lib/receipt-totes.ts).
        const bcSystemId = String(r.systemId ?? "").trim()
        const receiptNo  = String(r.receiptNo ?? "").trim()
        if (hasReceiptTotes && bcSystemId && receiptNo) {
          const rtCommon = {
            receiptNo,
            toteNo,
            lineNo:      typeof r.lineNo === "number" ? r.lineNo : null,
            vendorNo:    r.vendorNo ?? null,
            catalogued:  r.catalogued === true,
            ...(created ? { bcCreatedAt: created } : {}),
          }
          upserts.push(prisma.warehouseReceiptTote.upsert({
            where:  { bcSystemId },
            update: { ...rtCommon, syncedAt: new Date() },
            create: { bcSystemId, ...rtCommon },
          }))
        }
      }

      for (let i = 0; i < upserts.length; i += 20) {
        await Promise.all(upserts.slice(i, i + 20))
      }
      itemsProcessed += rowsSeen
      if (!nl) break
    }

    const more = !!currentLink

    // Walk finished — fill vendor names for totes totes-active never saw
    // (catalogued before the Hub existed), using names the receipt-lines sync
    // already holds per vendorNo. Best-effort: a miss just leaves the name null.
    if (!more && hasReceiptTotes) {
      // Names for the new table. ⚠ Unlike WarehouseTote's backfill this also REFRESHES a name that
      // no longer matches its vendor number — the reason a tote row could show one customer's name
      // beside another customer's number was that the old backfill only ever filled NULLs.
      try {
        await prisma.$executeRaw`
          UPDATE "WarehouseReceiptTote" t
          SET "vendorName" = i."vendorName"
          FROM (
            SELECT DISTINCT ON ("vendorNo") "vendorNo", "vendorName"
            FROM "WarehouseItem"
            WHERE "vendorName" IS NOT NULL AND "vendorNo" IS NOT NULL
            ORDER BY "vendorNo"
          ) i
          WHERE t."vendorNo" = i."vendorNo"
            AND (t."vendorName" IS NULL OR t."vendorName" <> i."vendorName")`
      } catch {}
    }

    if (!more) {
      try {
        await prisma.$executeRaw`
          UPDATE "WarehouseTote" t
          SET "vendorName" = i."vendorName"
          FROM (
            SELECT DISTINCT ON ("vendorNo") "vendorNo", "vendorName"
            FROM "WarehouseItem"
            WHERE "vendorName" IS NOT NULL AND "vendorNo" IS NOT NULL
            ORDER BY "vendorNo"
          ) i
          WHERE t."vendorName" IS NULL AND t."vendorNo" = i."vendorNo"`
      } catch {}
    }

    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "complete", completedAt: new Date(), itemsProcessed },
    })
    return NextResponse.json({ ok: true, itemsProcessed, more, nextLink: currentLink, pages: pageCount, contentsField })

  } catch (e: any) {
    await prisma.warehouseSyncLog.update({
      where: { id: syncLog.id },
      data: { status: "failed", completedAt: new Date(), error: e.message, itemsProcessed },
    })
    return NextResponse.json({ error: e.message, itemsProcessed }, { status: 500 })
  }
}
