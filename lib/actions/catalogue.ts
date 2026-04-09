"use server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

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
  await prisma.catalogueAuction.create({
    data: { code, name, auctionDate: auctionDate ? new Date(auctionDate) : null, auctionType: auctionType || "GENERAL", eventName: eventName || null }
  })
  revalidatePath("/cataloguer/auctions")
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
  revalidatePath("/cataloguer/auctions")
  revalidatePath(`/cataloguer/auctions/${id}`)
}

export async function deleteAuction(id: string) {
  await requireCataloguer()
  await prisma.catalogueAuction.delete({ where: { id } })
  revalidatePath("/cataloguer/auctions")
}

export async function createLot(auctionId: string, formData: FormData) {
  await requireCataloguer()
  const data = extractLotData(formData)
  await prisma.catalogueLot.create({ data: { ...data, auctionId } })
  revalidatePath(`/cataloguer/auctions/${auctionId}`)
}

export async function updateLot(lotId: string, auctionId: string, formData: FormData) {
  await requireCataloguer()
  const data = extractLotData(formData)
  await prisma.catalogueLot.update({ where: { id: lotId }, data })
  revalidatePath(`/cataloguer/auctions/${auctionId}`)
}

export async function deleteLot(lotId: string, auctionId: string) {
  await requireCataloguer()
  await prisma.catalogueLot.delete({ where: { id: lotId } })
  revalidatePath(`/cataloguer/auctions/${auctionId}`)
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
