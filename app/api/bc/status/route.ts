import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getBCToken } from "@/lib/bc"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ connected: false, reason: "no_session" }, { status: 401 })

  const token = await getBCToken()
  if (!token) {
    return NextResponse.json({ connected: false, reason: "no_token" })
  }

  return NextResponse.json({ connected: true })
}
