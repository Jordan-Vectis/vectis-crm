import { prisma } from "@/lib/prisma"
import { COUNTRY_NAMES, ISO_NUMERIC } from "@/lib/country-names"
import { guessCountry } from "@/lib/vendor-country"

// Where our vendors (consignors) are based, by country, with the lots each country has sent in.
//
// ⚠ ONE PLACE, THREE OUTPUTS. The screen, the PDF and the spreadsheet all call this. Working the
// figures out separately in each is how a printed report ends up disagreeing with the screen it was
// printed from — the class of bug that made the F109 counts untrustworthy.
//
// "Vendors" is the C numbers that actually appear on receipts, not every vendor record BC holds.
// That scoping lives here rather than in the sync, so it can change without a re-pull.

export type VendorCountryRow = {
  code:       string
  name:       string
  isoNumeric: string | null
  vendors:    number
  receipts:   number
  lots:       number
  /** Share of all vendors / receipts / lots, as a percentage to one decimal place. */
  vendorPct:   number
  receiptPct:  number
  lotPct:      number
  worked:     number
  noAddress:  number
}

export type VendorLeftover = {
  vendorNo:   string
  name:       string | null
  city:       string | null
  county:     string | null
  postCode:   string | null
  hasAddress: boolean
}

export type VendorLocations = {
  rows:   VendorCountryRow[]
  totals: {
    vendors: number; receipts: number; lots: number; countries: number; workedOut: number
    unknown: number; notInBc: number; noAddress: number; unknownWithAddress: number
  }
  reasons:            { reason: string; count: number }[]
  unknownSample:      VendorLeftover[]
  vendorTableMissing: boolean
  vendorsKnown:       number
  lastSync:           string | null
}

export async function computeVendorLocations(): Promise<VendorLocations> {
  // ⚠ Grouped by vendor AND receipt in one pass, so a single query gives both figures: the lots
  // are the summed counts, and the receipts are the number of rows. Counting them separately would
  // be two scans of a 220,000-row table for the same answer.
  const perVendorReceipt = await prisma.warehouseItem.groupBy({
    by:     ["vendorNo", "receiptNo"],
    where:  { vendorNo: { not: null }, receiptNo: { not: null } },
    _count: { _all: true },
  })

  const lotsByVendor     = new Map<string, number>()
  const receiptsByVendor = new Map<string, number>()
  for (const row of perVendorReceipt) {
    const key = (row.vendorNo ?? "").trim().toUpperCase()
    if (!key) continue
    lotsByVendor.set(key, (lotsByVendor.get(key) ?? 0) + row._count._all)
    receiptsByVendor.set(key, (receiptsByVendor.get(key) ?? 0) + 1)
  }

  type VendorRow = {
    vendorNo: string; name: string | null; postCode: string | null; countryCode: string | null
    city: string | null; county: string | null; address: string | null; address2: string | null
    resolvedCountry: string | null; resolvedBy: string | null; resolvedNote: string | null
  }
  let vendors: VendorRow[] = []
  let vendorTableMissing = false
  try {
    vendors = await prisma.bcVendor.findMany({
      select: {
        vendorNo: true, name: true, postCode: true, countryCode: true, city: true, county: true,
        address: true, address2: true,
        resolvedCountry: true, resolvedBy: true, resolvedNote: true,
      },
    })
  } catch {
    vendorTableMissing = true   // pre-migration, or never synced
  }
  const byNo = new Map(vendors.map(v => [v.vendorNo.trim().toUpperCase(), v]))

  const buckets = new Map<string, VendorCountryRow>()
  const bucket = (code: string, name: string) => {
    let b = buckets.get(code)
    if (!b) {
      b = { code, name, isoNumeric: ISO_NUMERIC[code] ?? null, vendors: 0, receipts: 0, lots: 0, vendorPct: 0, receiptPct: 0, lotPct: 0, worked: 0, noAddress: 0 }
      buckets.set(code, b)
    }
    return b
  }

  let totalVendors = 0, totalLots = 0, totalReceipts = 0, workedOut = 0, unknown = 0, notInBc = 0, noAddress = 0
  const reasons = new Map<string, number>()
  const unknownRows: VendorLeftover[] = []

  for (const [vendorNo, lots] of lotsByVendor) {
    const receipts = receiptsByVendor.get(vendorNo) ?? 0
    totalVendors++
    totalLots += lots
    totalReceipts += receipts
    const v = byNo.get(vendorNo)

    // ⚠ BC holds NO country for any vendor (measured: 28,998 pulled, 0 with one), so this is worked
    // out from the address. Every answer carries the rule that decided it.
    let guess = v ? guessCountry(v) : { code: null as string | null, reason: "Not in the vendor list" }
    // ⚠ A country the HUB worked out is used ONLY where BC has none and the rules could not place
    // them, so it can never override something Business Central actually said.
    if (!guess.code && v?.resolvedCountry) {
      guess = {
        code:   v.resolvedCountry,
        reason: v.resolvedBy === "manual" ? "Set by hand" : "Worked out by the assistant",
      }
    }

    if (!guess.code) {
      unknown++
      // ⚠ Two very different cases. Someone with a town and a postcode we could not place is worth
      // a look. Someone with no address in BC at all can never be placed by any rule.
      const hasAnyAddress = !!(v && ((v.city ?? "").trim() || (v.county ?? "").trim() || (v.postCode ?? "").trim()))
      if (!hasAnyAddress) noAddress++
      if (!v) notInBc++
      const b = bucket("??", "Not known")
      b.vendors++; b.lots += lots; b.receipts += receipts
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
    const b = bucket(guess.code, COUNTRY_NAMES[guess.code] ?? guess.code)
    b.vendors++
    b.lots += lots
    b.receipts += receipts
    if (guess.reason !== "Country held in Business Central") { b.worked++; workedOut++ }
  }

  // Percentages of the whole, to one decimal. Worked out once here so the screen, the PDF and the
  // spreadsheet can never round differently from one another.
  const share = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0)
  for (const b of buckets.values()) {
    b.vendorPct  = share(b.vendors,  totalVendors)
    b.receiptPct = share(b.receipts, totalReceipts)
    b.lotPct     = share(b.lots,     totalLots)
  }

  const rows = [...buckets.values()].sort((a, b) =>
    b.vendors - a.vendors || b.lots - a.lots || a.name.localeCompare(b.name))

  const lastSync = await prisma.warehouseSyncLog.findFirst({
    where:   { source: "vendors", status: "complete" },
    orderBy: { completedAt: "desc" },
    select:  { completedAt: true },
  })

  return {
    rows,
    totals: {
      vendors:   totalVendors,
      receipts:  totalReceipts,
      lots:      totalLots,
      countries: rows.filter(r => r.code !== "??").length,
      workedOut,
      unknown,
      notInBc,
      noAddress,
      unknownWithAddress: unknown - noAddress,
    },
    reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    // Ones you could actually act on first, then the ones with no address at all.
    unknownSample: unknownRows.sort((a, b) =>
      Number(b.hasAddress) - Number(a.hasAddress) || a.vendorNo.localeCompare(b.vendorNo)),
    vendorTableMissing,
    vendorsKnown: vendors.length,
    lastSync: lastSync?.completedAt?.toISOString() ?? null,
  }
}
