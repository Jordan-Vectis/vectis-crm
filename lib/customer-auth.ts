import { cookies } from "next/headers"
import { prisma } from "@/lib/prisma"

export type CustomerSession = {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
  contactId: string | null
  shippingLine1: string | null
  shippingLine2: string | null
  shippingCity: string | null
  shippingCounty: string | null
  shippingPostcode: string | null
  billingLine1: string | null
  billingLine2: string | null
  billingCity: string | null
  billingCounty: string | null
  billingPostcode: string | null
  billingSameAsShipping: boolean
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("customer-token")?.value
  if (!token) return null

  const account = await prisma.customerAccount.findUnique({
    where: { sessionToken: token },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      contactId: true,
      shippingLine1: true,
      shippingLine2: true,
      shippingCity: true,
      shippingCounty: true,
      shippingPostcode: true,
      billingLine1: true,
      billingLine2: true,
      billingCity: true,
      billingCounty: true,
      billingPostcode: true,
      billingSameAsShipping: true,
    },
  })

  return account ?? null
}
