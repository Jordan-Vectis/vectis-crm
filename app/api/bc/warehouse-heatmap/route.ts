import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 120

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  // ── 1. Fetch all totes from BC ──────────────────────────────────────────────
  const toteRows = await bcFetchAll(token, "Receipt_Totes_Excel")

  // Try to detect a location field on the tote records directly
  // BC may expose it as EVA_TOT_Location, Location, Location_Code etc.
  const LOCATION_FIELD_CANDIDATES = [
    "EVA_TOT_Location", "EVA_TOT_LocationCode", "EVA_TOT_Location_Code",
    "Location", "Location_Code", "Bin_Code", "EVA_TOT_BinCode",
  ]
  const sampleRow = toteRows[0] ?? {}
  const directLocationField = LOCATION_FIELD_CANDIDATES.find(f => f in sampleRow) ?? null

  // ── 2. Build tote → current location map ───────────────────────────────────
  // If the direct field exists, use it. Otherwise fall back to ChangeLogEntries.
  const toteLocation = new Map<string, string>() // toteId → locationCode

  if (directLocationField) {
    // Direct field available — fast path
    for (const r of toteRows) {
      const id  = String(r["No_"] ?? r["EVA_TOT_No"] ?? "").trim()
      const loc = String(r[directLocationField] ?? "").trim()
      if (id) toteLocation.set(id, loc || "")
    }
  } else {
    // Seed all totes with empty location first
    for (const r of toteRows) {
      const id = String(r["No_"] ?? r["EVA_TOT_No"] ?? "").trim()
      if (id) toteLocation.set(id, "")
    }

    // Fetch all ChangeLogEntries for tote Location field changes
    // Returns every time any tote's Location field was changed — we take the latest per tote
    const SELECT = "Primary_Key_Field_1_Value,New_Value,Date_and_Time"
    const changeRows = await bcFetchAll(
      token,
      "ChangeLogEntries",
      `Field_Caption eq 'Location'`,
      SELECT,
      5000,
    )

    // Sort oldest → newest so later entries overwrite
    changeRows.sort((a, b) => (a.Date_and_Time ?? "").localeCompare(b.Date_and_Time ?? ""))

    for (const r of changeRows) {
      const id  = String(r.Primary_Key_Field_1_Value ?? "").trim()
      const loc = String(r.New_Value ?? "").trim()
      if (id && toteLocation.has(id)) {
        toteLocation.set(id, loc)
      }
    }
  }

  // ── 3. Build per-tote detail list ──────────────────────────────────────────
  const CAT_COL     = "EVA_TOT_ArticleCategory"
  const CATALOGUED  = "EVA_TOT_Catalogued"

  interface ToteEntry {
    id: string
    description: string
    category: string
    catalogued: boolean
    location: string
  }

  const totes: ToteEntry[] = toteRows.map(r => ({
    id:          String(r["No_"] ?? r["EVA_TOT_No"] ?? "").trim(),
    description: String(r["Description"] ?? r["EVA_TOT_Description"] ?? "").trim(),
    category:    String(r[CAT_COL] ?? "").trim(),
    catalogued:  r[CATALOGUED] === true,
    location:    toteLocation.get(String(r["No_"] ?? r["EVA_TOT_No"] ?? "").trim()) ?? "",
  }))

  // ── 4. Group by location ───────────────────────────────────────────────────
  const locationMap = new Map<string, ToteEntry[]>()

  for (const t of totes) {
    const key = t.location || "__UNLOCATED__"
    if (!locationMap.has(key)) locationMap.set(key, [])
    locationMap.get(key)!.push(t)
  }

  const unlocatedItems = locationMap.get("__UNLOCATED__") ?? []
  locationMap.delete("__UNLOCATED__")

  const locations = [...locationMap.entries()]
    .map(([code, items]) => ({
      code,
      total:      items.length,
      catalogued: items.filter(i => i.catalogued).length,
      uncatalogued: items.filter(i => !i.catalogued).length,
      items,
    }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }))

  return NextResponse.json({
    locations,
    unlocated: {
      code:  "UNLOCATED",
      total: unlocatedItems.length,
      catalogued:   unlocatedItems.filter(i => i.catalogued).length,
      uncatalogued: unlocatedItems.filter(i => !i.catalogued).length,
      items: unlocatedItems,
    },
    meta: {
      totalTotes:        totes.length,
      totalLocations:    locationMap.size,
      occupiedLocations: locations.filter(l => l.total > 0).length,
      directField:       directLocationField,
    },
  })
}
