import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  let durationMs: number
  let startedAt: string

  try {
    const body = await req.json()
    durationMs = Math.round(Number(body.durationMs))
    startedAt  = body.startedAt ?? new Date(Date.now() - durationMs).toISOString()
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }

  // Ignore very short or nonsensical sessions
  if (!durationMs || durationMs < 5_000 || durationMs > 86_400_000) {
    return NextResponse.json({ ok: true })
  }

  await prisma.researchLog.create({
    data: {
      userId:    session.user.id,
      userName:  session.user.name ?? session.user.email ?? "Unknown",
      durationMs,
      startedAt: new Date(startedAt),
    },
  })

  return NextResponse.json({ ok: true })
}
