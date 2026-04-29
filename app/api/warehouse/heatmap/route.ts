import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Fetch every container with its most recent movement (= current location)
  const containers = await prisma.warehouseContainer.findMany({
    select: {
      id: true,
      type: true,
      description: true,
      receiptId: true,
      movements: {
        orderBy: { movedAt: "desc" },
        take: 1,
        select: { locationCode: true, movedAt: true },
      },
    },
  })

  // All known locations
  const allLocations = await prisma.warehouseLocation.findMany({
    select: { code: true },
    orderBy: { code: "asc" },
  })

  // Group containers by their current location
  const byLocation = new Map<string, { id: string; type: string; description: string; receiptId: string }[]>()

  // Seed every known location with an empty array
  for (const loc of allLocations) {
    byLocation.set(loc.code, [])
  }

  let unlocated: { id: string; type: string; description: string; receiptId: string }[] = []

  for (const c of containers) {
    const entry = { id: c.id, type: c.type, description: c.description, receiptId: c.receiptId }
    if (c.movements.length === 0) {
      unlocated.push(entry)
    } else {
      const code = c.movements[0].locationCode
      if (!byLocation.has(code)) byLocation.set(code, [])
      byLocation.get(code)!.push(entry)
    }
  }

  const locations = [...byLocation.entries()].map(([code, items]) => ({
    code,
    total: items.length,
    totes:    items.filter(i => i.type?.toLowerCase().includes("tote")).length,
    barcodes: items.filter(i => !i.type?.toLowerCase().includes("tote")).length,
    items,
  }))

  // Sort: alphabetical by code
  locations.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }))

  return NextResponse.json({
    locations,
    unlocated: {
      total: unlocated.length,
      totes:    unlocated.filter(i => i.type?.toLowerCase().includes("tote")).length,
      barcodes: unlocated.filter(i => !i.type?.toLowerCase().includes("tote")).length,
      items: unlocated,
    },
    meta: {
      totalContainers: containers.length,
      totalLocations: allLocations.length,
      occupiedLocations: locations.filter(l => l.total > 0).length,
    },
  })
}
