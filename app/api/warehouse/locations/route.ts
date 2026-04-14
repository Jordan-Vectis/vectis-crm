import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const locations = await prisma.warehouseLocation.findMany({
    orderBy: { code: "asc" },
    select: { code: true },
  })

  return NextResponse.json(locations)
}
