import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"

export async function GET(req: NextRequest) {
  try {
    await requireWarehouseAccess("warehouse")
    const type = req.nextUrl.searchParams.get("type") || "tote"
    const prefix = type === "pallet" ? "p" : "t"
    const digits = type === "pallet" ? 5 : 6

    const containers = await prisma.warehouseContainer.findMany({
      where: { type },
      select: { id: true },
    })

    let maxNum = 0
    for (const c of containers) {
      const num = parseInt(c.id.replace(/^\D+/, ""), 10)
      if (!isNaN(num) && num > maxNum) maxNum = num
    }

    const nextId = `${prefix}${String(maxNum + 1).padStart(digits, "0")}`
    return NextResponse.json({ id: nextId })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
