import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { resolveTote, resolveReceipt } from "@/lib/receipt-totes"

// GET /api/warehouse/vendor-lookup?receipt=R007523
// GET /api/warehouse/vendor-lookup?tote=T024801
//
// For tote lookups: checks WarehouseTote first (BC-synced, has vendorNo directly),
// then falls back to WarehouseItem (in case only item-level data is present).
// For receipt lookups: checks WarehouseTote.receiptNo, then WarehouseItem.receiptNo.
//
// ⚠⚠ THE ANSWER CARRIES ITS OWN PROVENANCE (2026-09-08). This route used to return vendorNo /
// vendorName / receiptNo and nothing else, so the lot wizard could not tell:
//   • a row synced twenty minutes ago from one synced fourteen hours ago (the tote sync runs every
//     12 h, so a tote re-booked onto a new receipt this morning still answers with the PREVIOUS
//     customer until the next run), or
//   • a tote BC has already ticked Catalogued — i.e. a tote whose contents have been and gone, so
//     its receipt almost certainly is not the one being catalogued now, or
//   • a real receipt-tote row from a weaker WarehouseItem guess.
// All three columns were sitting unused in the table. They are returned now so the wizard can
// show an amber "check this" instead of the identical confident teal label it showed for every
// answer. Nothing here decides anything — it reports, a human decides.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const receipt = searchParams.get("receipt")?.trim()
    const tote    = searchParams.get("tote")?.trim()

    if (!receipt && !tote) {
      return NextResponse.json({ error: "Provide receipt or tote" }, { status: 400 })
    }

    const empty = { vendorNo: null, vendorName: null, receiptNo: null, catalogued: null, syncedAt: null, source: null }

    // ── Tote lookup ─────────────────────────────────────────────────────────────
    if (tote) {
      // ⚠⚠ FIRST: BC's own receipt-tote rows, where a tote is allowed to be on more than one
      // receipt — because in BC it can be. WarehouseTote below is unique on toteNo and therefore
      // answers with only one of them, chosen by whatever the sync wrote last. When BC has two,
      // we say so and fill NOTHING: the wizard shows the choice. Reporting the doubt is the whole
      // point; silently picking is what put a batch under the previous customer.
      const rt = await resolveTote(tote)
      if (rt) {
        if (rt.ambiguous) {
          return NextResponse.json({
            vendorNo: null, vendorName: null, receiptNo: null,
            catalogued: null, syncedAt: rt.rows[0]?.syncedAt?.toISOString() ?? null,
            source: "receipt-tote", ambiguous: true,
            options: rt.rows.map(r => ({
              receiptNo:  r.receiptNo,
              vendorNo:   r.vendorNo,
              vendorName: r.vendorName,
              catalogued: r.catalogued,
            })),
          })
        }
        const c = rt.chosen
        if (c?.vendorNo) {
          return NextResponse.json({
            vendorNo:   c.vendorNo,
            vendorName: c.vendorName ?? null,
            receiptNo:  c.receiptNo,
            catalogued: c.catalogued,
            syncedAt:   c.syncedAt?.toISOString() ?? null,
            source:     "receipt-tote",
            ambiguous:  false,
          })
        }
      }

      // Primary: WarehouseTote (BC-synced, vendor lives here)
      const wt = await prisma.warehouseTote.findFirst({
        where:  { toteNo: { equals: tote, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true, receiptNo: true, catalogued: true, syncedAt: true, location: true },
      })
      if (wt?.vendorNo) {
        return NextResponse.json({
          vendorNo:   wt.vendorNo,
          vendorName: wt.vendorName ?? null,
          receiptNo:  wt.receiptNo ?? null,
          catalogued: wt.catalogued ?? null,
          syncedAt:   wt.syncedAt?.toISOString() ?? null,
          location:   wt.location ?? null,
          source:     "tote",
        })
      }
      // The tote EXISTS but carries no receipt/vendor yet — a shell row from the Totes_Excel
      // sync (that feed is the tote master and has neither field). Say so explicitly rather than
      // falling through and letting it read as "not in BC": the wizard used to render this as an
      // empty "  ()" label with the not-found warning suppressed, which told the cataloguer
      // nothing at all.
      if (wt) {
        return NextResponse.json({ ...empty, source: "tote-shell", knownTote: true })
      }
      // Fallback: WarehouseItem (item-level data). ⚠ This is a HISTORICAL guess, not BC's record
      // of the tote: WarehouseItem.toteNo is the tote a line was CREATED FROM, so it can name a
      // vendor from a receipt long since closed, and it carries no receipt we can trust. Marked as
      // such so the wizard can present it as weak evidence instead of a confident fill.
      const wi = await prisma.warehouseItem.findFirst({
        where:  { toteNo: { equals: tote, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true },
      })
      if (wi?.vendorNo) {
        return NextResponse.json({
          vendorNo: wi.vendorNo, vendorName: wi.vendorName ?? null, receiptNo: null,
          catalogued: null, syncedAt: null, source: "item",
        })
      }
      return NextResponse.json(empty)
    }

    // ── Receipt lookup ───────────────────────────────────────────────────────────
    if (receipt) {
      // Same order: BC's receipt-tote rows first, WarehouseTote after.
      const rr = await resolveReceipt(receipt)
      if (rr?.vendorNo) {
        if (rr.vendors.length > 1) {
          return NextResponse.json({
            vendorNo: null, vendorName: null, receiptNo: receipt,
            catalogued: null, syncedAt: null, source: "receipt-tote",
            ambiguous: true, vendors: rr.vendors,
          })
        }
        return NextResponse.json({
          vendorNo: rr.vendorNo, vendorName: rr.vendorName, receiptNo: receipt,
          catalogued: null, syncedAt: null, source: "receipt-tote", ambiguous: false,
        })
      }

      // Primary: WarehouseTote (has receiptNo + vendor)
      const wt = await prisma.warehouseTote.findFirst({
        where:  { receiptNo: { equals: receipt, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true, catalogued: true, syncedAt: true },
      })
      if (wt?.vendorNo) {
        return NextResponse.json({
          vendorNo:   wt.vendorNo,
          vendorName: wt.vendorName ?? null,
          receiptNo:  receipt,
          catalogued: wt.catalogued ?? null,
          syncedAt:   wt.syncedAt?.toISOString() ?? null,
          source:     "tote",
        })
      }
      // Fallback: WarehouseItem
      const wi = await prisma.warehouseItem.findFirst({
        where:  { receiptNo: { equals: receipt, mode: "insensitive" } },
        select: { vendorNo: true, vendorName: true },
      })
      if (wi?.vendorNo) {
        return NextResponse.json({
          vendorNo: wi.vendorNo, vendorName: wi.vendorName ?? null, receiptNo: receipt,
          catalogued: null, syncedAt: null, source: "item",
        })
      }
      return NextResponse.json(empty)
    }
  } catch (e: any) {
    console.error("vendor-lookup error:", e)
    return NextResponse.json({ error: e?.message ?? "Lookup failed" }, { status: 500 })
  }
}
