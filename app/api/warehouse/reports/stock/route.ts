import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"
import * as XLSX from "xlsx"

export async function GET(_req: NextRequest) {
  try {
    await requireWarehouseAccess("manager")
    const containers = await prisma.warehouseContainer.findMany({
      include: {
        receipt: { include: { customer: true } },
        movements: {
          orderBy: { movedAt: "desc" },
          take: 1,
          include: { location: true },
        },
      },
      orderBy: { id: "asc" },
    })

    const rows = containers.map(c => ({
      "Container ID": c.id,
      "Type": c.type,
      "Description": c.description,
      "Receipt": c.receiptId,
      "Customer ID": c.receipt.customerId,
      "Customer Name": c.receipt.customer.name,
      "Location": c.movements[0]?.location.code ?? "Unlocated",
      "Created": new Date(c.createdAt).toLocaleDateString(),
    }))

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, "Stock")
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="stock-report-${new Date().toISOString().slice(0,10)}.xlsx"`,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
