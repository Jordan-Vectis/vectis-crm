"use server"

import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"

export async function registerToBid(
  auctionId: string,
): Promise<{ success: true; alreadyRegistered?: boolean } | { error: string }> {
  const cookieStore = await cookies()
  const token = cookieStore.get("customer-token")?.value
  if (!token) return { error: "not_logged_in" }

  const account = await prisma.customerAccount.findUnique({
    where: { sessionToken: token },
    select: { id: true, contactId: true, firstName: true, lastName: true },
  })
  if (!account) return { error: "session_expired" }

  // Check auction exists and is published
  const auction = await prisma.catalogueAuction.findUnique({
    where: { id: auctionId },
    select: { id: true, published: true },
  })
  if (!auction || !auction.published) return { error: "auction_not_found" }

  // Upsert — idempotent if already registered
  const existing = await prisma.bidderRegistration.findUnique({
    where: { auctionId_customerAccountId: { auctionId, customerAccountId: account.id } },
  })
  if (existing) return { success: true, alreadyRegistered: true }

  await prisma.bidderRegistration.create({
    data: {
      auctionId,
      customerAccountId: account.id,
      contactId: account.contactId ?? null,
      acceptedTerms: true,
    },
  })

  return { success: true }
}

export async function getMyRegistrations(): Promise<string[]> {
  const cookieStore = await cookies()
  const token = cookieStore.get("customer-token")?.value
  if (!token) return []

  const account = await prisma.customerAccount.findUnique({
    where: { sessionToken: token },
    select: { id: true },
  })
  if (!account) return []

  const regs = await prisma.bidderRegistration.findMany({
    where: { customerAccountId: account.id },
    select: { auctionId: true },
  })
  return regs.map(r => r.auctionId)
}
