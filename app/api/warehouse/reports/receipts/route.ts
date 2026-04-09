import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireWarehouseAccess } from "@/lib/warehouse-auth"
import * as XLSX from "xlsx"

export async function GET(req: NextRequest) {
  try {
    await requireWarehouseAccess("manager")
    const dateFrom = req.nextUrl.searchParams.get("date_from")
    const dateTo = req.nextUrl.searchParams.get("date_to")
    const customerId = req.nextUrl.searchParams.get("customer_id")

    const receipts = await prisma.warehouseReceipt.findMany({
      where: {
        ...(customerId ? { customerId } : {}),
        ...(dateFrom || dateTo ? {
          createdAt: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo + "T23:59:59Z") } : {}),
          },
        } : {}),
      },
      include: {
        customer: true,
        containers: true,
      },
      orderBy: { createdAt: "desc" },
    })

    const rows = receipts.map(r => ({
      "Receipt ID": r.id,
      "Customer ID": r.customerId,
      "Customer Name": r.customer.name,
      "Commission Rate (%)": r.commissionRate,
      "Container Count": r.containers.length,
      "Status": r.status,
      "Notes": r.notes ?? "",
      "Created": new Date(r.createdAt).toLocaleDateString(),
    }))

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, ws, "Receipts")
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="receipts-report-${new Date().toISOString().slice(0,10)}.xlsx"`,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 403 })
  }
}
