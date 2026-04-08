import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { cookies } from "next/headers"
import { jwtDecrypt } from "jose"

function encKey() {
  const buf = Buffer.alloc(32)
  Buffer.from(process.env.AUTH_SECRET!).copy(buf)
  return buf
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ connected: false, reason: "no_session" }, { status: 401 })

  const cookieStore = await cookies()
  const raw = cookieStore.get("bc_token")?.value

  if (!raw) {
    return NextResponse.json({ connected: false, reason: "no_cookie" })
  }

  try {
    const { payload } = await jwtDecrypt(raw, encKey())
    const data = payload as any

    if (!data.access_token) {
      return NextResponse.json({ connected: false, reason: "no_access_token" })
    }

    if (data.expires_at <= Date.now() + 60_000) {
      return NextResponse.json({ connected: false, reason: "token_expired" })
    }

    return NextResponse.json({ connected: true })
  } catch (e: any) {
    return NextResponse.json({ connected: false, reason: "decrypt_failed", error: e.message })
  }
}
