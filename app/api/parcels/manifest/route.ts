import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { createRmManifest, getRmManifest } from "@/lib/royal-mail"

/** POST — create end-of-day manifest for all LABEL_CREATED parcels */
export async function POST(_req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const pendingParcels = await prisma.parcel.findMany({
      where: { status: "LABEL_CREATED" },
      select: { id: true, rmOrderIdentifier: true },
    })

    if (pendingParcels.length === 0) {
      return NextResponse.json({ error: "No parcels ready to manifest" }, { status: 400 })
    }

    const rmResponse = await createRmManifest()
    const manifestId = rmResponse?.manifestIdentifier ?? rmResponse?.id ?? null

    // Mark all as DISPATCHED
    await prisma.parcel.updateMany({
      where: { status: "LABEL_CREATED" },
      data: {
        status:      "DISPATCHED",
        manifestId:  manifestId ?? undefined,
        despatchedAt: new Date(),
      },
    })

    return NextResponse.json({ ok: true, manifestId, count: pendingParcels.length, rmResponse })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/** GET — poll manifest status */
export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })

    const manifestId = req.nextUrl.searchParams.get("id")
    if (!manifestId) return NextResponse.json({ error: "id required" }, { status: 400 })

    const data = await getRmManifest(manifestId)
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
