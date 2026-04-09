import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const rows = await prisma.aiPreset.findMany()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.instruction
  return NextResponse.json(map)
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const { key, instruction } = await req.json()
  if (!key || typeof instruction !== "string")
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  await prisma.aiPreset.upsert({
    where: { key },
    update: { instruction },
    create: { key, instruction },
  })
  return NextResponse.json({ ok: true })
}
