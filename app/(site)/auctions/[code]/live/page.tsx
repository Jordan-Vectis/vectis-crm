import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { lotPhotoUrl } from "@/lib/photo-url"
import LiveBiddingRoom from "./live-bidding-room"

export const dynamic = "force-dynamic"

export default async function LiveAuctionPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params

  const auction = await prisma.catalogueAuction.findFirst({
    where: { code: code.toUpperCase(), published: true },
    include: {
      lots: { orderBy: { lotNumber: "asc" } },
      liveAuction: true,
    },
  })

  if (!auction) notFound()

  const lots = auction.lots.map(l => ({
    id: l.id,
    lotNumber: l.lotNumber,
    title: l.title,
    description: l.description,
    imageUrls: l.imageUrls.map(k => lotPhotoUrl(k, true) ?? k),
    estimateLow: l.estimateLow,
    estimateHigh: l.estimateHigh,
    hammerPrice: l.hammerPrice,
    status: l.status,
  }))

  return (
    <LiveBiddingRoom
      auctionId={auction.id}
      auctionName={auction.name}
      auctionCode={auction.code}
      auctionDate={auction.auctionDate?.toISOString() ?? null}
      initialLotIndex={auction.liveAuction?.currentLotIndex ?? 0}
      isLive={!!auction.liveAuction && auction.liveAuction.status === "ACTIVE"}
      lots={lots}
    />
  )
}
