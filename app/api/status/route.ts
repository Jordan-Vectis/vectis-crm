import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getStatusView } from "@/lib/status/engine"

export const dynamic = "force-dynamic"

// GET /api/status — the Status Centre's current picture: every service's state,
// its uptime history and the recent alerts. Admin-only, like the page.
export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }
    return NextResponse.json(await getStatusView())
  } catch (e: any) {
    console.error("status GET error:", e)
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
