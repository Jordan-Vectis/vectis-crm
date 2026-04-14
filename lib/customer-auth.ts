import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"

export type CustomerSession = {
  id: string
  email: string
  firstName: string
  lastName: string
  contactId: string | null
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("customer-token")?.value
  if (!token) return null

  const account = await prisma.customerAccount.findUnique({
    where: { sessionToken: token },
    select: { id: true, email: true, firstName: true, lastName: true, contactId: true },
  })

  return account ?? null
}
