import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { createRmOrders, getRmLabel, type RmOrderPayload } from "@/lib/royal-mail"

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params

    const parcel = await prisma.parcel.findUnique({
      where: { id },
      include: { lots: { include: { lot: { select: { lotNumber: true, title: true, hammerPrice: true } } } } },
    })
    if (!parcel) return NextResponse.json({ error: "Not found" }, { status: 404 })
    if (parcel.status === "DISPATCHED") return NextResponse.json({ error: "Already dispatched" }, { status: 400 })

    const now = new Date().toISOString()
    const shortRef = parcel.reference.slice(0, 8).toUpperCase()

    const contents = parcel.lots.length > 0
      ? parcel.lots.map(pl => ({
          name:              `${pl.lot.lotNumber} – ${pl.lot.title}`.slice(0, 100),
          quantity:          1,
          unitValue:         pl.lot.hammerPrice ?? 0,
          unitWeightInGrams: Math.floor(parcel.weightInGrams / parcel.lots.length),
        }))
      : [{ name: "Auction goods", quantity: 1, unitValue: 0, unitWeightInGrams: parcel.weightInGrams }]

    const payload: RmOrderPayload = {
      orderReference:      `VEC-${shortRef}`,
      orderDate:           now,
      plannedDespatchDate: now,
      subtotal:            0,
      shippingCostCharged: 0,
      total:               0,
      recipient: {
        address: {
          fullName:     parcel.recipientName,
          ...(parcel.recipientCompany ? { companyName: parcel.recipientCompany } : {}),
          addressLine1: parcel.recipientLine1,
          ...(parcel.recipientLine2 ? { addressLine2: parcel.recipientLine2 } : {}),
          city:         parcel.recipientCity,
          ...(parcel.recipientCounty ? { county: parcel.recipientCounty } : {}),
          postcode:     parcel.recipientPostcode,
          countryCode:  parcel.recipientCountry,
        },
        ...(parcel.recipientEmail ? { emailAddress: parcel.recipientEmail } : {}),
        ...(parcel.recipientPhone ? { mobilePhone:  parcel.recipientPhone  } : {}),
      },
      packages: [{
        weightInGrams:           parcel.weightInGrams,
        packageFormatIdentifier: parcel.packageFormat,
        contents,
      }],
      postageDetails: {
        serviceCode:          parcel.serviceCode,
        sendNotificationsTo:  parcel.recipientEmail ? "recipient" : "sender",
      },
      ...(parcel.specialInstructions ? { specialInstructions: parcel.specialInstructions } : {}),
    }

    // Create order in Click & Drop
    const rmResponse = await createRmOrders([payload])
    const createdOrder = rmResponse?.createdOrders?.[0]
    if (!createdOrder?.orderIdentifier) {
      return NextResponse.json({ error: "Royal Mail did not return an order identifier", detail: rmResponse }, { status: 502 })
    }

    // Fetch label PDF
    const pdfBuffer = await getRmLabel(createdOrder.orderIdentifier)
    const base64Pdf = Buffer.from(pdfBuffer).toString("base64")

    // Save to DB
    const updated = await prisma.parcel.update({
      where: { id },
      data: {
        rmOrderIdentifier: createdOrder.orderIdentifier,
        trackingNumber:    createdOrder.trackingNumber ?? null,
        labelPdf:          base64Pdf,
        status:            "LABEL_CREATED",
      },
    })

    return NextResponse.json({
      ok:                true,
      rmOrderIdentifier: updated.rmOrderIdentifier,
      trackingNumber:    updated.trackingNumber,
      labelPdf:          updated.labelPdf,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

/** GET — return stored label PDF */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session) return NextResponse.json({ error: "Unauthorised" }, { status: 401 })
    const { id } = await params
    const parcel = await prisma.parcel.findUnique({ where: { id }, select: { labelPdf: true } })
    if (!parcel?.labelPdf) return NextResponse.json({ error: "No label" }, { status: 404 })

    const buf = Buffer.from(parcel.labelPdf, "base64")
    return new NextResponse(buf, {
      headers: {
        "Content-Type":        "application/pdf",
        "Content-Disposition": "inline; filename=label.pdf",
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
