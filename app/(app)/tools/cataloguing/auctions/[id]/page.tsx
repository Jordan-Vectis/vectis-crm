import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import AuctionTabs from "./auction-tabs"

export default async function AuctionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!["ADMIN", "CATALOGUER"].includes(session.user.role)) redirect("/submissions")

  const { id } = await params

  const [auction, photoSessions] = await Promise.all([
    prisma.catalogueAuction.findUnique({
      where: { id },
      include: { lots: { orderBy: { lotNumber: "asc" } } },
    }),
    prisma.cataloguePhotoSession.findMany({
      where: { auctionId: id },
      orderBy: { createdAt: "desc" },
    }),
  ])

  if (!auction) notFound()

  return (
    <AuctionTabs
      auction={{
        id: auction.id,
        code: auction.code,
        name: auction.name,
        auctionDate: auction.auctionDate,
        auctionType: auction.auctionType,
        eventName: auction.eventName,
        notes: auction.notes,
        locked: auction.locked,
        finished: auction.finished,
        complete: auction.complete,
      }}
      lots={auction.lots.map(l => ({
        id: l.id,
        lotNumber: l.lotNumber,
        title: l.title,
        description: l.description,
        estimateLow: l.estimateLow,
        estimateHigh: l.estimateHigh,
        reserve: l.reserve,
        hammerPrice: l.hammerPrice,
        condition: l.condition,
        vendor: l.vendor,
        tote: l.tote,
        receipt: l.receipt,
        category: l.category,
        subCategory: l.subCategory,
        brand: l.brand,
        notes: l.notes,
        status: l.status,
        createdByName: l.createdByName,
        imageUrls: l.imageUrls,
      }))}
      photoSessions={photoSessions.map(s => ({
        id: s.id,
        lotBarcode: s.lotBarcode,
        customerRef: s.customerRef,
        itemPhotoKeys: s.itemPhotoKeys,
        status: s.status,
        createdByName: s.createdByName,
        createdAt: s.createdAt.toISOString(),
      }))}
    />
  )
}
