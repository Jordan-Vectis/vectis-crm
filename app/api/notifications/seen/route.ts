import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { markNotificationsSeen } from "@/lib/notifications"

export const dynamic = "force-dynamic"

// POST /api/notifications/seen — the admin opened the bell: everything up to now is read.
export async function POST() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }
    const ok = await markNotificationsSeen(session.user.id)
    return NextResponse.json({ ok })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
