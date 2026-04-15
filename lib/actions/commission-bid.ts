"use server"

import { prisma } from "@/lib/prisma"
import { getCustomerSession } from "@/lib/customer-auth"
import { getMinBid, isValidBid, roundUpToBid, nextBid } from "@/lib/bid-increments"

export type PlaceBidResult =
  | { success: true; updated: boolean; maxBid: number; outbid: false }
  | { success: true; updated: boolean; maxBid: number; outbid: true; currentLeadingBid: number }
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

  // Enforce minimum bid (60% of low estimate, rounded up to nearest increment)
  const minBid = getMinBid(lot.estimateLow)
  if (maxBid < minBid) {
    return { error: `Minimum bid for this lot is £${minBid.toLocaleString("en-GB")}.` }
  }

  // Enforce valid increment
  if (!isValidBid(maxBid)) {
    const suggested = roundUpToBid(maxBid)
    return { error: `£${maxBid.toLocaleString("en-GB")} is not a valid bid increment. The nearest valid amount is £${suggested.toLocaleString("en-GB")}.` }
  }

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

  // Check if this customer is immediately outbid by a DIFFERENT bidder's commission bid
  // We explicitly exclude the current customer so they can never be shown as outbid by themselves
  const topCompetingBid = await prisma.commissionBid.findFirst({
    where: {
      lotId,
      customerAccountId: { not: session.id },  // strictly other customers only
    },
    orderBy: { maxBid: "desc" },
  })

  if (topCompetingBid && topCompetingBid.maxBid >= maxBid) {
    // Another bidder's max beats this customer — leading bid is one increment above theirs
    const currentLeadingBid = nextBid(maxBid)
    return {
      success: true,
      updated: !!existing,
      maxBid: bid.maxBid,
      outbid: true,
      currentLeadingBid,
    }
  }

  return { success: true, updated: !!existing, maxBid: bid.maxBid, outbid: false }
}
