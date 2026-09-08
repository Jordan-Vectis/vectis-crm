import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { searchReceiptTotes } from "@/lib/receipt-totes"

// GET /api/warehouse/tote-search?q=T025
// Searches WarehouseTote (BC-synced) by toteNo — used by the lot wizard tote field.
//
// ⚠ PREFIX FIRST, "anywhere" only as a fallback (2026-09-08). Tote numbers are typed by hand, one
// character at a time, so an unanchored `contains` answers a half-typed "P0050" with every tote
// whose number contains those digits anywhere — a list of unrelated consignments presented in the
// same ascending order as the real neighbours. Matching from the START is what somebody typing a
// number from the start actually means. The `contains` search is kept as a second try so a
// deliberate partial search still finds something rather than returning nothing.
//
// ⚠ `catalogued` and `syncedAt` are returned so the wizard can tell a fresh row from a stale one
// and a tote BC has already finished with from one it has not. They were in the table and unused.
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
    if (!q) return NextResponse.json([])

    // ⚠⚠ BC's own receipt-tote rows first: ONE ENTRY PER RECEIPT-TOTE PAIR. A tote booked onto two
    // receipts appears twice, each with its own receipt and customer, so the cataloguer picks the
    // right one instead of being handed whichever the tote-keyed cache happened to keep. Falls back
    // to WarehouseTote when the table is not migrated/populated yet, which is the old behaviour.
    const rt = await searchReceiptTotes(q)
    if (rt) {
      return NextResponse.json(rt.map(r => ({
        toteNo:     r.toteNo,
        vendorNo:   r.vendorNo,
        vendorName: r.vendorName,
        receiptNo:  r.receiptNo,
        location:   null,
        catalogued: r.catalogued,
        syncedAt:   r.syncedAt,
      })))
    }

    const select = {
      toteNo:     true,
      vendorNo:   true,
      vendorName: true,
      receiptNo:  true,
      location:   true,
      catalogued: true,
      syncedAt:   true,
    } as const

    let totes = await prisma.warehouseTote.findMany({
      where:   { toteNo: { startsWith: q, mode: "insensitive" } },
      select,
      orderBy: { toteNo: "asc" },
      take:    20,
    })

    if (totes.length === 0) {
      totes = await prisma.warehouseTote.findMany({
        where:   { toteNo: { contains: q, mode: "insensitive" } },
        select,
        orderBy: { toteNo: "asc" },
        take:    20,
      })
    }

    return NextResponse.json(totes)
  } catch (e: any) {
    console.error("tote-search error:", e)
    return NextResponse.json({ error: e?.message ?? "Search failed" }, { status: 500 })
  }
}
