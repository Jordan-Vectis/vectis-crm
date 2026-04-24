import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const auctions = await prisma.catalogueAuction.findMany({
    select: { code: true, name: true, auctionDate: true },
    orderBy: { auctionDate: "desc" },
  })

  return NextResponse.json(auctions)
}
