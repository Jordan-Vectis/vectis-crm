import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcFetchAll } from "@/lib/bc"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const token = await getBCToken()
  if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

  const rows = await bcFetchAll(token, "Auction_Receipt_Lines_Excel", "Location_Code eq 'COLLECTED'", undefined, 500)

  return NextResponse.json({ count: rows.length })
}
