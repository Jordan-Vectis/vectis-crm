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

    const filter = `New_Value eq 'COLLECTED' and Field_Caption eq 'Article Location Code'`
    const rows = await bcFetchAll(token, "ChangeLogEntries", filter, "Primary_Key_Field_1_Value,Date_and_Time", 500)

    const fromStr = from ? `${from}T00:00:00` : null
    const toStr   = to   ? `${to}T23:59:59`   : null

    const filtered = rows.filter(r => {
      const d = r.Date_and_Time ?? ""
      if (fromStr && d < fromStr) return false
      if (toStr   && d > toStr)   return false
      return true
    })

    return NextResponse.json({ count: filtered.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
