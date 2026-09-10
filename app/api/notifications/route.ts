import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { listNotifications } from "@/lib/notifications"

export const dynamic = "force-dynamic"

// GET /api/notifications — the admin bell: the latest notifications and how many
// are unread. Admin-only (the bell only renders for admins). Returns an empty
// list with available:false until Run Migrations has created the tables.
export async function GET() {
  try {
    const session = await auth()
    if (!session || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    }
    return NextResponse.json(await listNotifications(session.user.id))
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 })
  }
}
