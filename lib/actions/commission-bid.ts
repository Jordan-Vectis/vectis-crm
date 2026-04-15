"use server"

import { prisma } from "@/lib/prisma"
import { getCustomerSession } from "@/lib/customer-auth"

export type PlaceBidResult =
  | { success: true; updated: boolean; maxBid: number }
  | { error: string }

export async function placeCommissionBid(
  lotId: string,
  maxBid: number
): Promise<PlaceBidResult> {
  const session = await getCustomerSession()
  if (!session) return { error: "You must be logged in to place a bid." }

  if (!maxBid || maxBid < 1) return { error: "Please enter a valid bid amount." }

  // Check lot exists and auction is published + not finished
  const lot = await prisma.catalogueLot.findUnique({
    where: { id: lotId },
    include: { auction: { select: { published: true, finished: true, complete: true } } },
  })

  if (!lot) return { error: "Lot not found." }
  if (!lot.auction.published) return { error: "This auction is not available." }
  if (lot.auction.finished || lot.auction.complete) return { error: "This auction has ended." }

  // Check bidder is registered
  const reg = await prisma.bidderRegistration.findFirst({
    where: {
      auctionId: lot.auctionId,
      customerAccountId: session.id,
    },
  })
  if (!reg) return { error: "You must register to bid before placing a bid." }

  // Upsert commission bid
  const existing = await prisma.commissionBid.findUnique({
    where: { lotId_customerAccountId: { lotId, customerAccountId: session.id } },
  })

  const bid = await prisma.commissionBid.upsert({
    where: { lotId_customerAccountId: { lotId, customerAccountId: session.id } },
    create: {
      lotId,
      customerAccountId: session.id,
      maxBid,
      contactId: session.contactId ?? undefined,
    },
    update: {
      maxBid,
      updatedAt: new Date(),
    },
  })

  return { success: true, updated: !!existing, maxBid: bid.maxBid }
}
