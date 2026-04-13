import { prisma } from "@/lib/prisma"
import DatabasesClient from "./databases-client"

export default async function DatabasesPage() {
  const [contacts, receipts, containers, lots] = await Promise.all([
    prisma.contact.findMany({
      orderBy: { name: "asc" },
      take: 3000,
    }),
    prisma.warehouseReceipt.findMany({
      include: { contact: true, containers: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
    prisma.warehouseContainer.findMany({
      include: {
        receipt: { include: { contact: true } },
        movements: { orderBy: { movedAt: "desc" }, take: 1, select: { locationCode: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
    prisma.catalogueLot.findMany({
      include: { auction: { select: { code: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
  ])

  return (
    <DatabasesClient
      contacts={contacts.map(c => ({
        id: c.id, name: c.name, email: c.email ?? null,
        phone: c.phone ?? null, notes: c.notes ?? null,
        isBuyer: c.isBuyer, isSeller: c.isSeller,
      }))}
      receipts={receipts.map(r => ({
        id: r.id, contactId: r.contactId, contactName: r.contact.name,
        commissionRate: r.commissionRate, notes: r.notes ?? null,
        status: r.status, containerCount: r.containers.length,
      }))}
      containers={containers.map(c => ({
        id: c.id, type: c.type, description: c.description,
        category: c.category ?? null, subcategory: c.subcategory ?? null,
        receiptId: c.receiptId, contactId: c.receipt.contactId,
        contactName: c.receipt.contact.name,
        lastLocation: c.movements[0]?.locationCode ?? null,
      }))}
      lots={lots.map(l => ({
        id: l.id, lotNumber: l.lotNumber, title: l.title,
        auctionCode: l.auction.code, auctionName: l.auction.name,
        vendor: l.vendor ?? null, receipt: l.receipt ?? null,
        tote: l.tote ?? null, category: l.category ?? null,
        subCategory: l.subCategory ?? null, status: l.status,
        estimateLow: l.estimateLow ?? null, estimateHigh: l.estimateHigh ?? null,
        imageCount: l.imageUrls.length,
      }))}
    />
  )
}
