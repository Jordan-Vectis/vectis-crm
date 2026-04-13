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

  const lotNumber   = (formData.get("lotNumber") as string)?.trim() || ""
  const customerRef = (formData.get("customerRef") as string)?.trim() || null
  const photoFiles  = formData.getAll("itemPhoto") as File[]

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
    data: { auctionId, lotNumber, title: "", description: "", vendor: customerRef || null, status: "ENTERED", imageUrls, createdByName },
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

function extractLotData(formData: FormData) {
  return {
    lotNumber:   (formData.get("lotNumber") as string) || "",
    title:       (formData.get("title") as string) || "",
    description: (formData.get("description") as string) || "",
    estimateLow:  formData.get("estimateLow")  ? parseInt(formData.get("estimateLow") as string)  : null,
    estimateHigh: formData.get("estimateHigh") ? parseInt(formData.get("estimateHigh") as string) : null,
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
