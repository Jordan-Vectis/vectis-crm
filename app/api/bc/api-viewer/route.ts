import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPage } from "@/lib/bc"

export const maxDuration = 60

// GET /api/bc/api-viewer?endpoint=XXX&limit=5&filter=...
// Fetches a small sample from any BC OData endpoint and returns field names + rows.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 503 })

  const { searchParams } = req.nextUrl
  const endpoint = searchParams.get("endpoint")?.trim() ?? ""
  const limit    = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "5"), 1), 50)
  const filter   = searchParams.get("filter")?.trim() ?? ""
  const orderby  = searchParams.get("orderby")?.trim() ?? ""

  if (!endpoint) return NextResponse.json({ error: "No endpoint specified" }, { status: 400 })

  try {
    const params: Record<string, any> = { $top: limit }
    if (filter)  params.$filter  = filter
    if (orderby) params.$orderby = orderby

    const rows = await bcPage(token, endpoint, params)

    const fields = rows.length > 0
      ? Object.keys(rows[0]).map(key => ({
          name:    key,
          sample:  rows[0][key],
          allNull: rows.every(r => r[key] === null || r[key] === "" || r[key] === undefined),
        }))
      : []

    return NextResponse.json({ endpoint, fields, rows, count: rows.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "BC request failed" }, { status: 500 })
  }
}
