import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

    const { searchParams } = req.nextUrl
    const from = searchParams.get("from")
    const to   = searchParams.get("to")

    let filter = `New_Value eq 'COLLECTED' and Field_Caption eq 'Article Location Code'`
    if (from) filter += ` and Date_and_Time ge ${from}T00:00:00Z`
    if (to)   filter += ` and Date_and_Time le ${to}T23:59:59Z`

    const rows = await bcFetchAll(token, "ChangeLogEntries", filter, "Primary_Key_Field_1_Value", 500)

    return NextResponse.json({ count: rows.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
