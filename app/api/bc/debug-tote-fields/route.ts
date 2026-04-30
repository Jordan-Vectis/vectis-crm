import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPage } from "@/lib/bc"

export const maxDuration = 60

/**
 * Diagnostic endpoint — returns raw field names from Receipt_Totes_Excel
 * and samples ChangeLogEntries field captions to identify how tote locations
 * are tracked in this BC instance.
 */
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  const result: Record<string, any> = {}

  // 1. Raw fields from Receipt_Totes_Excel (first row, no $select)
  try {
    const totes = await bcPage(token, "Receipt_Totes_Excel", { $top: 1 })
    result.toteFields = totes[0] ? Object.keys(totes[0]) : []
    result.toteFirstRow = totes[0] ?? null
  } catch (e: any) {
    result.toteError = e.message
  }

  // 2. Distinct Field_Caption values from ChangeLogEntries for any tote-like record
  //    Try a few known captions to see which exist
  const captionsToTest = [
    "Location",
    "Article Location Code",
    "Location Code",
    "Bin Code",
    "EVA_TOT_Location",
    "Article Location",
    "New Location",
  ]
  result.changeLogSamples = {}
  for (const caption of captionsToTest) {
    try {
      const rows = await bcPage(token, "ChangeLogEntries", {
        $filter:  `Field_Caption eq '${caption}'`,
        $select:  "Primary_Key_Field_1_Value,Primary_Key_Field_2_Value,New_Value,Old_Value,Date_and_Time",
        $orderby: "Date_and_Time desc",
        $top:     3,
      })
      result.changeLogSamples[caption] = rows
    } catch (e: any) {
      result.changeLogSamples[caption] = { error: e.message }
    }
  }

  // 3. Try fetching a few raw ChangeLogEntries with NO filter to see what captions exist
  try {
    const rawLog = await bcPage(token, "ChangeLogEntries", {
      $select:  "Field_Caption,Primary_Key_Field_1_Value,New_Value,Date_and_Time",
      $orderby: "Date_and_Time desc",
      $top:     50,
    })
    // Collect distinct Field_Caption values
    const captions = [...new Set(rawLog.map((r: any) => r.Field_Caption))].sort()
    result.recentChangeLogCaptions = captions
    result.recentChangeLogSample = rawLog.slice(0, 5)
  } catch (e: any) {
    result.recentChangeLogError = e.message
  }

  // 4. Try alternative endpoints that might give location data
  for (const endpoint of ["WarehouseEntries", "ItemLedgerEntries", "Bin_Content"]) {
    try {
      const rows = await bcPage(token, endpoint, { $top: 1 })
      result[`${endpoint}_fields`] = rows[0] ? Object.keys(rows[0]) : []
    } catch (e: any) {
      result[`${endpoint}_error`] = e.message
    }
  }

  return NextResponse.json(result)
}
