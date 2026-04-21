import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { IMPERSONATE_COOKIE } from "@/lib/impersonation"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params

  // Prevent impersonating yourself
  if (id === session.user.id) {
    return NextResponse.json({ error: "Cannot impersonate yourself" }, { status: 400 })
  }

  // Verify target user exists and is not an admin
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true } })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
  if (target.role === "ADMIN") {
    return NextResponse.json({ error: "Cannot impersonate another admin" }, { status: 400 })
  }

  const base = _req.headers.get("x-forwarded-host")
    ? `${_req.headers.get("x-forwarded-proto") ?? "https"}://${_req.headers.get("x-forwarded-host")}`
    : new URL(_req.url).origin

  const res = NextResponse.redirect(`${base}/hub`)
  res.cookies.set(IMPERSONATE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  })
  return res
}
