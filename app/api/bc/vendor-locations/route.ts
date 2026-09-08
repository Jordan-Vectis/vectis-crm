import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { COUNTRY_NAMES, ISO_NUMERIC } from "@/lib/country-names"
import { guessCountry } from "@/lib/vendor-country"

export const maxDuration = 60

// GET /api/bc/vendor-locations
// Where our vendors (consignors) are based, by country, with how many lots each country has sent.
//
// "Vendors" here means what Jordan asked for: the C numbers that actually appear on receipts, not
// every vendor record in Business Central. That scoping is done HERE rather than in the sync, so it
// can change without a re-pull.
//
// Reads two tables we already sync:
//   • WarehouseItem — one row per receipt line, carrying receiptNo + vendorNo. This is both the
//     list of vendors on receipts AND the lot count per vendor.
//   • BcVendor      — the address, from /api/warehouse/sync/vendors.
//
// ⚠ COUNTRY IS PARTLY INFERRED, AND IT SAYS SO ON SCREEN. Business Central leaves the country blank
// for home-country records, which is most of the book. A blank country on a UK-shaped postcode is
// counted as United Kingdom and reported separately in `assumedUk` so the figure is never presented
// as something BC actually said. A blank country with no usable postcode stays Unknown — never
// quietly folded into the UK, which would make the headline look tidier than the data is.

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    // Lots per vendor, and therefore the vendors that are on receipts at all.
    const perVendor = await prisma.warehouseItem.groupBy({
      by:    ["vendorNo"],
      where: { vendorNo: { not: null }, receiptNo: { not: null } },
      _count: { _all: true },
    })

    const lotsByVendor = new Map<string, number>()
    for (const row of perVendor) {
      const key = (row.vendorNo ?? "").trim().toUpperCase()
      if (!key) continue
      lotsByVendor.set(key, (lotsByVendor.get(key) ?? 0) + row._count._all)
    }

    let vendors: { vendorNo: string; name: string | null; postCode: string | null; countryCode: string | null; city: string | null; county: string | null }[] = []
    let vendorTableMissing = false
    try {
      vendors = await prisma.bcVendor.findMany({
        select: { vendorNo: true, name: true, postCode: true, countryCode: true, city: true, county: true },
      })
    } catch {
      vendorTableMissing = true   // pre-migration, or never synced
    }
    const byNo = new Map(vendors.map(v => [v.vendorNo.trim().toUpperCase(), v]))

    type Bucket = { code: string; name: string; isoNumeric: string | null; vendors: number; lots: number; worked: number; noAddress: number }
    const buckets = new Map<string, Bucket>()
    const bucket = (code: string, name: string) => {
      let b = buckets.get(code)
      if (!b) {
        b = { code, name, isoNumeric: ISO_NUMERIC[code] ?? null, vendors: 0, lots: 0, worked: 0, noAddress: 0 }
        buckets.set(code, b)
      }
      return b
    }

    let totalVendors = 0, totalLots = 0, assumedUk = 0, unknown = 0, notInBc = 0, noAddress = 0
    const reasons = new Map<string, number>()
    const unknownRows: { vendorNo: string; name: string | null; city: string | null; county: string | null; postCode: string | null; hasAddress: boolean }[] = []

    for (const [vendorNo, lots] of lotsByVendor) {
      totalVendors++
      totalLots += lots
      const v = byNo.get(vendorNo)

      // ⚠ BC holds NO country for any vendor (measured: 28,998 pulled, 0 with one), so this is
      // worked out from the address. Every answer carries the rule that decided it, and anything
      // the rules cannot place stays Not known rather than being folded into the UK.
      const guess = v ? guessCountry(v) : { code: null, reason: "Not in the vendor list" }
      const code  = guess.code

      if (!code) {
        unknown++
        // ⚠ Two very different cases, and lumping them together makes the report look worse than
        // it is. Someone with a town and a postcode we could not place is worth a look. Someone
        // with no address in BC at all can never be placed by any rule, and saying so is the
        // honest answer rather than leaving it looking like something to fix.
        const hasAnyAddress = !!(v && ((v.city ?? "").trim() || (v.county ?? "").trim() || (v.postCode ?? "").trim()))
        if (!hasAnyAddress) noAddress++
        if (!v) notInBc++
        const b = bucket("??", "Not known")
        b.vendors++; b.lots += lots
        if (!hasAnyAddress) b.noAddress++
        unknownRows.push({
          vendorNo,
          name:     v?.name ?? null,
          city:     v?.city ?? null,
          county:   v?.county ?? null,
          postCode: v?.postCode ?? null,
          hasAddress: hasAnyAddress,
        })
        continue
      }

      reasons.set(guess.reason, (reasons.get(guess.reason) ?? 0) + 1)
      const b = bucket(code, COUNTRY_NAMES[code] ?? code)
      b.vendors++
      b.lots += lots
      if (guess.reason !== "Country held in Business Central") { b.worked++; assumedUk++ }
    }

    const rows = [...buckets.values()].sort((a, b) =>
      b.vendors - a.vendors || b.lots - a.lots || a.name.localeCompare(b.name))

    const lastSync = await prisma.warehouseSyncLog.findFirst({
      where:   { source: "vendors", status: "complete" },
      orderBy: { completedAt: "desc" },
      select:  { completedAt: true, itemsProcessed: true },
    })

    return NextResponse.json({
      ok: true,
      rows,
      totals: {
        vendors: totalVendors,
        lots:    totalLots,
        countries: rows.filter(r => r.code !== "??").length,
        workedOut: assumedUk,
        unknown,
        notInBc,
        noAddress,
        unknownWithAddress: unknown - noAddress,
      },
      unknownSample: unknownRows
        .sort((a, b) => Number(b.hasAddress) - Number(a.hasAddress) || a.vendorNo.localeCompare(b.vendorNo))
        .slice(0, 500),
      reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      vendorTableMissing,
      vendorsKnown: vendors.length,
      lastSync: lastSync?.completedAt?.toISOString() ?? null,
    })
  } catch (e: any) {
    console.error("vendor-locations error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to build the report" }, { status: 500 })
  }
}
