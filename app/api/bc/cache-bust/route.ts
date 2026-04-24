import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  try {
    await prisma.$executeRawUnsafe(`DELETE FROM "_bc_cache"`)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true }) // table may not exist yet — that's fine
  }
}
