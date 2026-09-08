import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { COUNTRY_NAMES } from "@/lib/country-names"
import { computeVendorLocations } from "@/lib/vendor-locations"

export const maxDuration = 60

// GET /api/bc/vendor-locations
// Where our vendors (consignors) are based, by country, with the receipts and lots each has sent.
//
// ⚠ The figures come from lib/vendor-locations.ts, which the PDF and the spreadsheet also use, so
// a printed report can never disagree with the screen it was printed from.
export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const d = await computeVendorLocations()

    return NextResponse.json({
      ok: true,
      ...d,
      // The on-screen list is capped; the spreadsheet carries every one.
      unknownSample: d.unknownSample.slice(0, 500),
      // For the per-row picker on the leftovers list.
      countryOptions: Object.entries(COUNTRY_NAMES)
        .map(([code, name]) => ({ code, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  } catch (e: any) {
    console.error("vendor-locations error:", e)
    return NextResponse.json({ error: e?.message ?? "Failed to build the report" }, { status: 500 })
  }
}
