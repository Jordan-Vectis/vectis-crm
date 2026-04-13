"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

async function requireAuth() {
  const session = await auth()
  if (!session) throw new Error("Not authenticated")
  return session
}

export async function updateContactDb(id: string, data: {
  name?: string; email?: string; phone?: string
  notes?: string; isBuyer?: boolean; isSeller?: boolean
}) {
  await requireAuth()
  await prisma.contact.update({ where: { id }, data })
  revalidatePath("/databases")
}

export async function updateReceiptDb(id: string, data: {
  commissionRate?: number; notes?: string; status?: string
}) {
  await requireAuth()
  await prisma.warehouseReceipt.update({ where: { id }, data })
  revalidatePath("/databases")
}

export async function updateContainerDb(id: string, data: {
  description?: string; category?: string; subcategory?: string
}) {
  await requireAuth()
  await prisma.warehouseContainer.update({ where: { id }, data })
  revalidatePath("/databases")
}
