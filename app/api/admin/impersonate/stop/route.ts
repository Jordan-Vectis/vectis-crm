import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { IMPERSONATE_COOKIE } from "@/lib/impersonation"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const base = req.headers.get("x-forwarded-host")
    ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("x-forwarded-host")}`
    : new URL(req.url).origin

  const res = NextResponse.redirect(`${base}/admin/users`)
  res.cookies.delete(IMPERSONATE_COOKIE)
  return res
}
