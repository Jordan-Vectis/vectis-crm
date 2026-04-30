import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPage } from "@/lib/bc"

export const maxDuration = 60

// GET /api/warehouse/location-history?uniqueId=R000006-1
// Returns ChangeLogEntries for Article Location Code changes on a specific item.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const uniqueId = req.nextUrl.searchParams.get("uniqueId")?.trim()
  if (!uniqueId) return NextResponse.json({ error: "uniqueId required" }, { status: 400 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  try {
    const rows = await bcPage(token, "ChangeLogEntries", {
      $filter:  `Field_Caption eq 'Article Location Code' and Primary_Key_Field_2_Value eq '${uniqueId}'`,
      $select:  "Primary_Key_Field_2_Value,Old_Value,New_Value,Date_and_Time,User_ID",
      $orderby: "Date_and_Time desc",
      $top:     100,
    })
    return NextResponse.json({ rows })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
