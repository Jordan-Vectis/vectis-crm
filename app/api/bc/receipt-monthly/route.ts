import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken, bcPage } from "@/lib/bc"

export const maxDuration = 60

export async function GET() {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const token = await getBCToken()
    if (!token) return NextResponse.json({ error: "BC_NOT_CONNECTED" }, { status: 401 })

    const sample = await bcPage(token, "EVA_AuctionLine", { $top: 1 })
    return NextResponse.json({ debug_fields: sample.length > 0 ? Object.keys(sample[0]) : [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
