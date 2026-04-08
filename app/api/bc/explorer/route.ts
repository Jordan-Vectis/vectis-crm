import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export const maxDuration = 300

const ALLOWED_ENDPOINTS: Record<string, string> = {
  "Auction_Receipt_Lines_Excel": "Auction_Receipt_Lines_Excel",
  "ShipmentRequestAPI":          "ShipmentRequestAPI",
  "CollectionList":              "CollectionList",
  "PostedCollectionList":        "PostedCollectionList",
  "Receipt_Totes_Excel":         "Receipt_Totes_Excel",
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

  const { searchParams } = req.nextUrl
  const endpoint = searchParams.get("endpoint") ?? ""
  const filter   = searchParams.get("filter")   ?? ""
  const orderby  = searchParams.get("orderby")  ?? ""

  if (!ALLOWED_ENDPOINTS[endpoint]) {
    return NextResponse.json({ error: "Unknown endpoint" }, { status: 400 })
  }

  const rows = await bcFetchAll(
    token,
    endpoint,
    filter   || undefined,
    undefined,
    500,
  )

  // If orderby specified, sort client-side (simple single-field sort)
  if (orderby) {
    const [field, dir] = orderby.trim().split(/\s+/)
    const desc = dir?.toLowerCase() === "desc"
    rows.sort((a, b) => {
      const av = a[field] ?? ""
      const bv = b[field] ?? ""
      if (av < bv) return desc ? 1 : -1
      if (av > bv) return desc ? -1 : 1
      return 0
    })
  }

  return NextResponse.json({ rows, total: rows.length })
}
