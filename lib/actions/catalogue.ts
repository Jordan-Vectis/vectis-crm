"use server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { uploadBufferToR2 } from "@/lib/r2"

async function requireCataloguer() {
  const session = await auth()
  if (!session || !["ADMIN","CATALOGUER"].includes(session.user.role)) throw new Error("Access denied")
  return session
}

export async function createAuction(formData: FormData) {
  await requireCataloguer()
  const code = (formData.get("code") as string).toUpperCase().trim()
  const name = formData.get("name") as string
  const auctionDate = formData.get("auctionDate") as string
  const auctionType = formData.get("auctionType") as string
  const eventName = formData.get("eventName") as string
  const auction = await prisma.catalogueAuction.create({
    data: { code, name, auctionDate: auctionDate ? new Date(auctionDate) : null, auctionType: auctionType || "GENERAL", eventName: eventName || null }
  })
  revalidatePath("/tools/cataloguing/auctions")
  return auction.id
}

export async function updateAuction(id: string, formData: FormData) {
  await requireCataloguer()
  const code = (formData.get("code") as string).toUpperCase().trim()
  const name = formData.get("name") as string
  const auctionDate = formData.get("auctionDate") as string
  const auctionType = formData.get("auctionType") as string
  const eventName = formData.get("eventName") as string
  const locked = formData.get("locked") === "true"
  const finished = formData.get("finished") === "true"
  const complete = formData.get("complete") === "true"
  await prisma.catalogueAuction.update({
    where: { id },
    data: { code, name, auctionDate: auctionDate ? new Date(auctionDate) : null, auctionType: auctionType || "GENERAL", eventName: eventName || null, locked, finished, complete }
  })
  revalidatePath("/tools/cataloguing/auctions")
  revalidatePath(`/tools/cataloguing/auctions/${id}`)
}

export async function deleteAuction(id: string) {
  await requireCataloguer()
  await prisma.catalogueAuction.delete({ where: { id } })
  revalidatePath("/tools/cataloguing/auctions")
}

export async function generateTitlesFromDescriptions(auctionId: string, lotIds: string[]) {
  await requireCataloguer()
  const lots = await prisma.catalogueLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, description: true } })
  await Promise.all(lots.map(l => {
    const title = l.description.trim().slice(0, 83).trimEnd()
    if (!title) return Promise.resolve()
    return prisma.catalogueLot.update({ where: { id: l.id }, data: { title } })
  }))
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function assignLotNumbers(auctionId: string, orderedIds: string[]) {
  await requireCataloguer()
  await Promise.all(orderedIds.map((id, i) =>
    prisma.catalogueLot.update({ where: { id }, data: { lotNumber: String(i + 1) } })
  ))
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function setStartingBids(auctionId: string, updates: { id: string; startingBid: number }[]) {
  await requireCataloguer()
  await Promise.all(updates.map(u =>
    prisma.catalogueLot.update({ where: { id: u.id }, data: { startingBid: u.startingBid } })
  ))
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function applyAiDescriptions(
  auctionId: string,
  updates: { id: string; description: string; estimateLow: number | null; estimateHigh: number | null }[]
) {
  await requireCataloguer()
  await Promise.all(
    updates.map(u =>
      prisma.catalogueLot.update({
        where: { id: u.id },
        data: { description: u.description, estimateLow: u.estimateLow, estimateHigh: u.estimateHigh, aiUpgraded: true },
      })
    )
  )
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function togglePublished(id: string, published: boolean) {
  await requireCataloguer()
  await prisma.catalogueAuction.update({ where: { id }, data: { published } })
  revalidatePath("/tools/cataloguing/auctions")
  revalidatePath(`/tools/cataloguing/auctions/${id}`)
  revalidatePath("/auctions")
}

export async function createLot(auctionId: string, formData: FormData) {
  const session = await requireCataloguer()
  const data = extractLotData(formData)
  const createdByName = session.user.name ?? session.user.email ?? "Unknown"

  const photoFiles = formData.getAll("photo") as File[]
  const imageUrls: string[] = []
  for (let i = 0; i < photoFiles.length; i++) {
    const f = photoFiles[i]
    if (f && f.size > 0) {
      const ext = f.name.split(".").pop() || "jpg"
      const buf = Buffer.from(await f.arrayBuffer())
      const key = await uploadBufferToR2(buf, `lot-photos/${auctionId}/${data.lotNumber || "lot"}-${Date.now()}-${i}.${ext}`, f.type || "image/jpeg")
      imageUrls.push(key)
    }
  }

  await prisma.catalogueLot.create({ data: { ...data, auctionId, createdByName, imageUrls } })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function createPhotoOnlyLot(auctionId: string, formData: FormData) {
  const session = await requireCataloguer()

  const lotNumber  = (formData.get("lotNumber") as string)?.trim() || ""
  const toteNumber = (formData.get("tote") as string)?.trim() || null
  const notes      = (formData.get("notes") as string)?.trim() || null
  const photoFiles = formData.getAll("itemPhoto") as File[]

  const imageUrls: string[] = []
  for (let i = 0; i < photoFiles.length; i++) {
    const f = photoFiles[i]
    if (f && f.size > 0) {
      const ext = f.name.split(".").pop() || "jpg"
      const buf = Buffer.from(await f.arrayBuffer())
      const key = await uploadBufferToR2(buf, `lot-photos/${auctionId}/${lotNumber}-${Date.now()}-${i}.${ext}`, f.type || "image/jpeg")
      imageUrls.push(key)
    }
  }

  const createdByName = session.user.name ?? session.user.email ?? "Unknown"
  await prisma.catalogueLot.create({
    data: { auctionId, lotNumber, title: "", description: "", tote: toteNumber || null, notes, status: "ENTERED", imageUrls, createdByName },
  })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function updateLot(lotId: string, auctionId: string, formData: FormData) {
  await requireCataloguer()
  const data = extractLotData(formData)
  await prisma.catalogueLot.update({ where: { id: lotId }, data })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function deleteLot(lotId: string, auctionId: string) {
  await requireCataloguer()
  await prisma.catalogueLot.delete({ where: { id: lotId } })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function toggleLotAiUpgraded(lotId: string, auctionId: string, value: boolean) {
  await requireCataloguer()
  await prisma.catalogueLot.update({ where: { id: lotId }, data: { aiUpgraded: value } })
  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
}

export async function createPhotoSession(formData: FormData) {
  const session = await requireCataloguer()

  const auctionId    = formData.get("auctionId") as string
  const lotBarcode   = (formData.get("lotBarcode") as string)?.trim() || null
  const customerRef  = (formData.get("customerRef") as string)?.trim() || null
  const notes        = (formData.get("notes") as string)?.trim() || null
  const barcodeFile  = formData.get("barcodePhoto") as File | null
  const itemFiles    = formData.getAll("itemPhoto") as File[]

  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const prefix    = `photo-sessions/${auctionId}/${sessionId}`

  let barcodePhotoKey: string | null = null
  if (barcodeFile && barcodeFile.size > 0) {
    const ext = barcodeFile.name.split(".").pop() || "jpg"
    const buf = Buffer.from(await barcodeFile.arrayBuffer())
    barcodePhotoKey = await uploadBufferToR2(buf, `${prefix}/barcode-${Date.now()}.${ext}`, barcodeFile.type || "image/jpeg")
  }

  const itemPhotoKeys: string[] = []
  for (let i = 0; i < itemFiles.length; i++) {
    const f = itemFiles[i]
    if (f && f.size > 0) {
      const ext = f.name.split(".").pop() || "jpg"
      const buf = Buffer.from(await f.arrayBuffer())
      const key = await uploadBufferToR2(buf, `${prefix}/item-${Date.now()}-${i}.${ext}`, f.type || "image/jpeg")
      itemPhotoKeys.push(key)
    }
  }

  const record = await prisma.cataloguePhotoSession.create({
    data: {
      auctionId,
      lotBarcode,
      customerRef,
      barcodePhotoKey,
      itemPhotoKeys,
      notes,
      status: "PENDING",
      createdById: session.user.id,
      createdByName: session.user.name ?? null,
    },
  })

  return {
    id: record.id,
    lotBarcode: record.lotBarcode,
    customerRef: record.customerRef,
    itemPhotoKeys: record.itemPhotoKeys,
    status: record.status,
    createdByName: record.createdByName,
    createdAt: record.createdAt.toISOString(),
  }
}

export async function fillLotsFromTotes(auctionId: string) {
  await requireCataloguer()

  const lots = await prisma.catalogueLot.findMany({
    where: { auctionId, tote: { not: null } },
    select: { id: true, tote: true, vendor: true, receipt: true },
  })

  if (lots.length === 0) return { updated: 0 }

  const toteIds = [...new Set(lots.map(l => l.tote!).filter(Boolean))]

  const toteMap = new Map<string, { vendor: string; receipt: string }>()
  for (const toteId of toteIds) {
    const container = await prisma.warehouseContainer.findUnique({
      where: { id: toteId },
      include: { receipt: true },
    })
    if (container) {
      toteMap.set(toteId, {
        vendor: container.receipt.contactId,
        receipt: container.receiptId,
      })
    }
  }

  let updated = 0
  for (const lot of lots) {
    if (!lot.tote) continue
    const info = toteMap.get(lot.tote)
    if (!info) continue
    if (!lot.vendor || !lot.receipt) {
      await prisma.catalogueLot.update({
        where: { id: lot.id },
        data: {
          vendor:  lot.vendor  || info.vendor,
          receipt: lot.receipt || info.receipt,
        },
      })
      updated++
    }
  }

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return { updated }
}

export async function uploadLotPhoto(lotId: string, auctionId: string, formData: FormData) {
  await requireCataloguer()

  const file = formData.get("photo") as File
  if (!file || file.size === 0) throw new Error("No file provided")

  const ext = file.name.split(".").pop() || "jpg"
  const buf = Buffer.from(await file.arrayBuffer())
  const key = await uploadBufferToR2(
    buf,
    `lot-photos/${auctionId}/${lotId}/${Date.now()}.${ext}`,
    file.type || "image/jpeg"
  )

  const lot = await prisma.catalogueLot.update({
    where: { id: lotId },
    data: { imageUrls: { push: key } },
    select: { imageUrls: true },
  })

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return lot.imageUrls
}

export async function deleteLotPhoto(lotId: string, auctionId: string, key: string) {
  await requireCataloguer()

  const lot = await prisma.catalogueLot.findUnique({ where: { id: lotId }, select: { imageUrls: true } })
  if (!lot) throw new Error("Lot not found")

  const updated = lot.imageUrls.filter(k => k !== key)
  await prisma.catalogueLot.update({ where: { id: lotId }, data: { imageUrls: updated } })

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return updated
}

export async function importLots(auctionId: string, rows: {
  lotNumber: string; title: string; description: string
  estimateLow: string; estimateHigh: string; reserve: string
  condition: string; status: string; vendor: string
  tote: string; receipt: string; category: string
  subCategory: string; brand: string; notes: string
}[]) {
  const session = await requireCataloguer()
  const createdByName = session.user.name ?? session.user.email ?? "Unknown"

  for (const r of rows) {
    await prisma.catalogueLot.create({
      data: {
        auctionId,
        createdByName,
        lotNumber:    r.lotNumber,
        title:        r.title || "",
        description:  r.description || "",
        estimateLow:  r.estimateLow  ? parseInt(r.estimateLow)  : null,
        estimateHigh: r.estimateHigh ? parseInt(r.estimateHigh) : null,
        reserve:      r.reserve      ? parseInt(r.reserve)      : null,
        hammerPrice:  null,
        condition:    r.condition    || null,
        status:       r.status       || "ENTERED",
        vendor:       r.vendor       || null,
        tote:         r.tote         || null,
        receipt:      r.receipt      || null,
        category:     r.category     || null,
        subCategory:  r.subCategory  || null,
        brand:        r.brand        || null,
        notes:        r.notes        || null,
        imageUrls:    [],
      },
    })
  }

  revalidatePath(`/tools/cataloguing/auctions/${auctionId}`)
  return rows.length
}

function extractLotData(formData: FormData) {
  return {
    lotNumber:   (formData.get("lotNumber") as string) || "",
    barcode:     (formData.get("barcode") as string) || null,
    title:       (formData.get("title") as string) || "",
    description: (formData.get("description") as string) || "",
    estimateLow:  formData.get("estimateLow")  ? parseInt(formData.get("estimateLow") as string)  : null,
    estimateHigh: formData.get("estimateHigh") ? parseInt(formData.get("estimateHigh") as string) : null,
    startingBid:  formData.get("startingBid")  ? parseInt(formData.get("startingBid") as string)  : null,
    reserve:      formData.get("reserve")      ? parseInt(formData.get("reserve") as string)      : null,
    hammerPrice:  formData.get("hammerPrice")  ? parseInt(formData.get("hammerPrice") as string)  : null,
    condition:   (formData.get("condition") as string) || null,
    vendor:      (formData.get("vendor") as string) || null,
    tote:        (formData.get("tote") as string) || null,
    receipt:     (formData.get("receipt") as string) || null,
    category:    (formData.get("category") as string) || null,
    subCategory: (formData.get("subCategory") as string) || null,
    brand:       (formData.get("brand") as string) || null,
    notes:       (formData.get("notes") as string) || null,
    status:      (formData.get("status") as string) || "ENTERED",
  }
}
