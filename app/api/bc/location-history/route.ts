import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 60

const SELECT = "Primary_Key_Field_1_Value,Primary_Key_Field_2_Value,Old_Value,New_Value,Date_and_Time,User_ID,Field_Caption"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  const { searchParams } = req.nextUrl
  const input = (searchParams.get("q") ?? "").trim()
  const mode  = (searchParams.get("mode") ?? "tote") as "tote" | "barcode"

  if (!input) return NextResponse.json({ error: "No input" }, { status: 400 })

  try {
    let field1: string
    let field2: string | null = null

    if (mode === "tote") {
      // Direct — tote number IS the primary key field 1
      field1 = input
    } else {
      // Barcode — find the item keys via New_Value
      const barcodeRows = await bcFetchAll(
        token,
        "ChangeLogEntries",
        `New_Value eq '${input}' and Field_Caption eq 'Internal Barcode'`,
        SELECT,
        50
      )
      if (barcodeRows.length === 0) {
        return NextResponse.json({ error: `No BC record found for barcode "${input}"` }, { status: 404 })
      }
      // Take the first match — most barcodes are unique
      field1 = barcodeRows[0].Primary_Key_Field_1_Value ?? ""
      field2 = barcodeRows[0].Primary_Key_Field_2_Value ?? null
    }

    if (!field1) return NextResponse.json({ error: "Could not determine primary key" }, { status: 404 })

    // Fetch all location change entries for this item
    const fieldCaption = mode === "tote" ? "Location" : "Article Location Code"
    let filter = `Primary_Key_Field_1_Value eq '${field1}' and Field_Caption eq '${fieldCaption}'`
    if (field2) filter += ` and Primary_Key_Field_2_Value eq '${field2}'`

    const rows = await bcFetchAll(token, "ChangeLogEntries", filter, SELECT, 500)

    // Sort newest first
    rows.sort((a, b) => {
      const at = a.Date_and_Time ?? ""
      const bt = b.Date_and_Time ?? ""
      return bt.localeCompare(at)
    })

    return NextResponse.json({
      field1,
      field2,
      entries: rows.map(r => ({
        from:      r.Old_Value   ?? "",
        to:        r.New_Value   ?? "",
        changedBy: r.User_ID     ?? "",
        changedAt: r.Date_and_Time ?? "",
      })),
    })
  } catch (err) {
    console.error("[location-history]", err)
    return NextResponse.json({ error: "BC query failed" }, { status: 500 })
  }
}
