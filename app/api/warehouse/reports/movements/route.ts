import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"
import * as XLSX from "xlsx"

export async function GET(req: NextRequest) {
  try {
    await requireWarehouseAccess("manager")
    const containerId = req.nextUrl.searchParams.get("container_id")
    const location = req.nextUrl.searchParams.get("location")
    const dateFrom = req.nextUrl.searchParams.get("date_from")
    const dateTo = req.nextUrl.searchParams.get("date_to")

    const movements = await prisma.warehouseMovement.findMany({
      where: {
        ...(containerId ? { containerId: { contains: containerId, mode: "insensitive" } } : {}),
        ...(location ? { locationCode: { contains: location, mode: "insensitive" } } : {}),
        ...(dateFrom || dateTo ? {
          movedAt: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo + "T23:59:59Z") } : {}),
          },
        } : {}),
      },
      include: { container: true, location: true },
      orderBy: { movedAt: "desc" },
    })

    const rows = movements.map(m => ({
      "Container ID": m.containerId,
      "Type": m.container.type,
      "Description": m.container.description,
      "Location": m.locationCode,
      "Moved At": new Date(m.movedAt).toLocaleString(),
      "By": m.movedByName ?? "",
      "Notes": m.notes ?? "",
    }))

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, "Movements")
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="movements-report-${new Date().toISOString().slice(0,10)}.xlsx"`,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
