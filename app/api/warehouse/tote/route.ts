import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET /api/warehouse/tote?toteNo=123
// Returns all WarehouseItems in a given tote from the local DB.
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  const toteNo = req.nextUrl.searchParams.get("toteNo")?.trim()
  if (!toteNo) return NextResponse.json({ error: "toteNo required" }, { status: 400 })

  const rows = await prisma.warehouseItem.findMany({
    where: { toteNo: { contains: toteNo } },
    select: {
      uniqueId: true,
      description: true,
      artist: true,
      location: true,
      binCode: true,
      toteNo: true,
      auctionCode: true,
      lotNo: true,
      currentLotNo: true,
      category: true,
      vendorName: true,
    },
    take: 500,
  })

  return NextResponse.json({ rows })
}
