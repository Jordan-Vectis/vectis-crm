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

    const debugUrl = `https://api.businesscentral.dynamics.com/v2.0/${process.env.BC_TENANT_ID}/${process.env.BC_ENVIRONMENT ?? "production"}/ODataV4/Company('${encodeURIComponent(process.env.BC_COMPANY ?? "Vectis")}')/EVA_AuctionLine`
    try {
      const sample = await bcPage(token, "EVA_AuctionLine", { $top: 1 })
      return NextResponse.json({ debug_fields: sample.length > 0 ? Object.keys(sample[0]) : [], url: debugUrl })
    } catch (bcErr: any) {
      return NextResponse.json({ error: bcErr.message, url: debugUrl })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 })
  }
}
