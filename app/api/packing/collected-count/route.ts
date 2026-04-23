import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

  // Get containers whose most recent movement is to COLLECTED
  const result = await prisma.$queryRaw<{ count: bigint }[]>`
    WITH latest AS (
      SELECT DISTINCT ON ("containerId") "containerId", "locationCode"
      FROM "WarehouseMovement"
      ORDER BY "containerId", "movedAt" DESC
    )
    SELECT COUNT(cl.id) AS count
    FROM "CatalogueLot" cl
    INNER JOIN latest ON latest."containerId" = cl.tote
    WHERE latest."locationCode" = 'COLLECTED'
  `

  const count = Number(result[0]?.count ?? 0)
  return NextResponse.json({ count })
}
