import { prisma } from "@/lib/prisma"

// Reading BC's own receipt-tote rows — the table where a tote number is allowed to appear more
// than once, because in Business Central it genuinely can.
//
// ⚠⚠ WHAT THIS IS FOR, AND WHAT IT IS NOT FOR.
// `WarehouseTote` is UNIQUE on toteNo. Its upsert therefore keeps ONE receipt per tote number —
// whichever the sync wrote last — and every screen reading it gets a single confident answer to a
// question that sometimes has two. That is how a whole batch ends up under the previous customer.
//
// This module reads `WarehouseReceiptTote` instead, which keeps every row BC has. It is used ONLY
// by the lot wizard's lookups, so the wizard can SAY "this tote is on two receipts, pick one"
// rather than silently choosing. It is deliberately not wired into Tote Check, Locking Check,
// End of Day, BC Corrections or Match BC: those all read WarehouseTote and build a tote-keyed map
// from it, and their behaviour must not change (the 2026-08-20 revert — the noisy flagging is what
// led Jordan to find the duplicated receipts in BC in the first place).
//
// ⚠ MIGRATION-SAFE. Code reaches Railway before Run Migrations is clicked, so every read here
// returns `null` if the table is not there yet and the caller falls back to exactly what it did
// before. A missing table must never surface as an error to a cataloguer.

export type ReceiptToteRow = {
  receiptNo:   string
  toteNo:      string
  vendorNo:    string | null
  vendorName:  string | null
  catalogued:  boolean
  bcCreatedAt: Date | null
  syncedAt:    Date
}

export type ToteResolution = {
  /** Every receipt BC has this tote on, newest receipt first. */
  rows:      ReceiptToteRow[]
  /** The one to offer. Null when there is no sensible single answer. */
  chosen:    ReceiptToteRow | null
  /** BC has this tote on more than one receipt — say so, never guess. */
  ambiguous: boolean
}

/**
 * Which row to offer when BC has the tote on several receipts.
 *
 * An un-catalogued receipt is the live one: BC ticks Catalogued when a tote's contents have been
 * worked through, so a catalogued row describes a consignment that has been and gone. Among
 * equals the highest receipt number is the most recent booking.
 *
 * ⚠ This only decides what to SHOW FIRST. When `ambiguous` is true the caller must present the
 * choice rather than fill anything in — picking for somebody is the exact behaviour that put four
 * correct lots onto the wrong receipt on F109.
 */
function pick(rows: ReceiptToteRow[]): ReceiptToteRow | null {
  if (rows.length === 0) return null
  const live = rows.filter(r => !r.catalogued)
  const pool = live.length > 0 ? live : rows
  return pool[0] ?? null
}

const byReceiptDesc = (a: ReceiptToteRow, b: ReceiptToteRow) =>
  b.receiptNo.localeCompare(a.receiptNo, undefined, { numeric: true })

/**
 * ⚠⚠ FILL IN THE CUSTOMER NAME. The eva/tot API this table is built from has **no vendor name
 * field at all** — only the number — and the name is backfilled from WarehouseItem, but only at the
 * end of a completed walk. Until that lands every row here has a null name, and because the wizard
 * asks this table FIRST it showed every tote as "No customer name in BC" while the old path had the
 * name all along. Measured live 2026-09-09 on T027150: number and receipt right, name blank.
 *
 * The name is the one thing a cataloguer can check against the paperwork, so a missing one is not a
 * cosmetic problem. Filled from WarehouseTote (same lineage, written by the active-totes sync) and
 * then WarehouseItem, in one query each and only when something is actually missing.
 */
async function withVendorNames(rows: ReceiptToteRow[]): Promise<ReceiptToteRow[]> {
  const missing = [...new Set(rows.filter(r => !r.vendorName && r.vendorNo).map(r => r.vendorNo!.trim()))]
  if (missing.length === 0) return rows

  const names = new Map<string, string>()
  const add = (no: string | null, name: string | null) => {
    const k = (no ?? "").trim().toUpperCase()
    if (k && name && !names.has(k)) names.set(k, name)
  }
  try {
    const totes = await prisma.warehouseTote.findMany({
      where:  { vendorNo: { in: missing }, vendorName: { not: null } },
      select: { vendorNo: true, vendorName: true },
      take:   500,
    })
    for (const t of totes) add(t.vendorNo, t.vendorName)
  } catch { /* best effort */ }

  const still = missing.filter(no => !names.has(no.toUpperCase()))
  if (still.length) {
    try {
      const items = await prisma.warehouseItem.findMany({
        where:  { vendorNo: { in: still }, vendorName: { not: null } },
        select: { vendorNo: true, vendorName: true },
        take:   500,
      })
      for (const i of items) add(i.vendorNo, i.vendorName)
    } catch { /* best effort */ }
  }

  return rows.map(r => r.vendorName
    ? r
    : { ...r, vendorName: names.get((r.vendorNo ?? "").trim().toUpperCase()) ?? null })
}

/** Every receipt BC has this tote on. Returns null when the table is not available. */
export async function resolveTote(toteNo: string): Promise<ToteResolution | null> {
  const q = (toteNo ?? "").trim()
  if (!q) return null
  try {
    const found = await prisma.warehouseReceiptTote.findMany({
      where:  { toteNo: { equals: q, mode: "insensitive" } },
      select: {
        receiptNo: true, toteNo: true, vendorNo: true, vendorName: true,
        catalogued: true, bcCreatedAt: true, syncedAt: true,
      },
      take: 25,
    })
    // No rows is a real answer ("BC has this tote on no receipt") ONLY once the table is populated.
    // Before the first sync after Run Migrations it is empty for every tote, which would turn every
    // lookup into "not in BC" — so an empty result defers to the caller's existing path instead.
    if (found.length === 0) return null
    const rows = await withVendorNames([...found].sort(byReceiptDesc))
    // A tote booked twice onto the SAME receipt (several lines) is not an ambiguity — it is one
    // consignment. Only distinct receipts count.
    const distinctReceipts = new Set(rows.map(r => r.receiptNo.trim().toUpperCase())).size
    return { rows, chosen: pick(rows), ambiguous: distinctReceipts > 1 }
  } catch {
    return null   // table not migrated yet, or unreadable — caller falls back
  }
}

/** The vendor behind a receipt, from BC's receipt-tote rows. Null when unavailable. */
export async function resolveReceipt(receiptNo: string): Promise<{ vendorNo: string | null; vendorName: string | null; vendors: string[] } | null> {
  const q = (receiptNo ?? "").trim()
  if (!q) return null
  try {
    const rows = await prisma.warehouseReceiptTote.findMany({
      where:  { receiptNo: { equals: q, mode: "insensitive" } },
      select: { vendorNo: true, vendorName: true },
      take: 200,
    })
    if (rows.length === 0) return null
    const vendors = [...new Set(rows.map(r => (r.vendorNo ?? "").trim().toUpperCase()).filter(Boolean))]
    const first = rows.find(r => r.vendorNo) ?? rows[0]
    const [named] = await withVendorNames([{
      receiptNo: q, toteNo: "", vendorNo: first.vendorNo ?? null, vendorName: first.vendorName ?? null,
      catalogued: false, bcCreatedAt: null, syncedAt: new Date(),
    }])
    return { vendorNo: first.vendorNo ?? null, vendorName: named?.vendorName ?? null, vendors }
  } catch {
    return null
  }
}

/**
 * Dropdown rows for the wizard's tote box: one entry per RECEIPT-tote pair, so a tote on two
 * receipts offers both and the cataloguer picks the right one instead of being handed whichever
 * the cache happened to keep. Returns null when the table is unavailable.
 */
export async function searchReceiptTotes(q: string, take = 20): Promise<ReceiptToteRow[] | null> {
  const query = (q ?? "").trim()
  if (!query) return null
  try {
    let rows = await prisma.warehouseReceiptTote.findMany({
      where:  { toteNo: { startsWith: query, mode: "insensitive" } },
      select: {
        receiptNo: true, toteNo: true, vendorNo: true, vendorName: true,
        catalogued: true, bcCreatedAt: true, syncedAt: true,
      },
      orderBy: [{ toteNo: "asc" }, { receiptNo: "desc" }],
      take,
    })
    if (rows.length === 0) {
      rows = await prisma.warehouseReceiptTote.findMany({
        where:  { toteNo: { contains: query, mode: "insensitive" } },
        select: {
          receiptNo: true, toteNo: true, vendorNo: true, vendorName: true,
          catalogued: true, bcCreatedAt: true, syncedAt: true,
        },
        orderBy: [{ toteNo: "asc" }, { receiptNo: "desc" }],
        take,
      })
    }
    return rows.length > 0 ? await withVendorNames(rows) : null
  } catch {
    return null
  }
}
