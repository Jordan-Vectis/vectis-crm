import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

  const { searchParams } = req.nextUrl
  const from = searchParams.get("from") ?? ""
  const to   = searchParams.get("to")   ?? ""
  if (!from || !to) return NextResponse.json({ error: "Missing from/to" }, { status: 400 })

  const filter = `EVA_ShipmentDate ge ${from} and EVA_ShipmentDate le ${to}`

  // Fetch all shipment records — no $select so we can auto-detect address fields
  const all = await bcFetchAll(token, "ShipmentRequestAPI", filter)

  // Filter out cancelled shipments
  const active = all.filter((s) => s.EVA_Status !== "Cancelled")

  if (active.length === 0) {
    return NextResponse.json({
      byCountry: [],
      byCity:    [],
      meta:      { total: 0, countries: 0, cities: 0 },
    })
  }

  // Auto-detect the country and city field names from the first record
  const firstKeys = Object.keys(active[0])
  const countryKey = firstKeys.find((k) => /country/i.test(k)) ?? null
  const cityKey    = firstKeys.find((k) => /city/i.test(k))    ?? null

  // Aggregate by country
  const countryCounts: Record<string, number> = {}
  const cityCounts:    Record<string, { count: number; country: string }> = {}

  for (const row of active) {
    const rawCountry = (countryKey ? (row[countryKey] ?? "") : "").toString().trim()
    const rawCity    = (cityKey    ? (row[cityKey]    ?? "") : "").toString().trim()

    const country = rawCountry || "Unknown"
    const city    = rawCity    || "Unknown"

    countryCounts[country] = (countryCounts[country] ?? 0) + 1

    if (!cityCounts[city]) cityCounts[city] = { count: 0, country }
    cityCounts[city].count++
  }

  const byCountry = Object.entries(countryCounts)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count)

  const byCity = Object.entries(cityCounts)
    .map(([city, { count, country }]) => ({ city, country, count }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({
    byCountry,
    byCity,
    meta: {
      total:     active.length,
      countries: byCountry.length,
      cities:    byCity.length,
    },
  })
}
