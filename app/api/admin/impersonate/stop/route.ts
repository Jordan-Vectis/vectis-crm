import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { IMPERSONATE_COOKIE } from "@/lib/impersonation"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const res = NextResponse.redirect(new URL("/admin/users", req.url))
  res.cookies.delete(IMPERSONATE_COOKIE)
  return res
}
