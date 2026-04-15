"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"

function generateToken(): string {
  const a = crypto.randomUUID().replace(/-/g, "")
  const b = crypto.randomUUID().replace(/-/g, "")
  return a + b
}

function str(formData: FormData, key: string): string {
  return ((formData.get(key) as string) ?? "").trim()
}

function optStr(formData: FormData, key: string): string | null {
  const v = str(formData, key)
  return v || null
}

export async function registerCustomer(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const email     = str(formData, "email").toLowerCase()
  const password  = str(formData, "password")
  const firstName = str(formData, "firstName")
  const lastName  = str(formData, "lastName")
  const phone     = optStr(formData, "phone")

  // Shipping
  const shippingLine1    = optStr(formData, "shippingLine1")
  const shippingLine2    = optStr(formData, "shippingLine2")
  const shippingCity     = optStr(formData, "shippingCity")
  const shippingCounty   = optStr(formData, "shippingCounty")
  const shippingPostcode = optStr(formData, "shippingPostcode")

  // Billing
  const billingSame      = formData.get("billingSameAsShipping") === "on"
  const billingLine1     = billingSame ? shippingLine1 : optStr(formData, "billingLine1")
  const billingLine2     = billingSame ? shippingLine2 : optStr(formData, "billingLine2")
  const billingCity      = billingSame ? shippingCity  : optStr(formData, "billingCity")
  const billingCounty    = billingSame ? shippingCounty : optStr(formData, "billingCounty")
  const billingPostcode  = billingSame ? shippingPostcode : optStr(formData, "billingPostcode")

  if (!email || !password || !firstName || !lastName) {
    return { error: "First name, last name, email and password are required" }
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" }
  }

  const existing = await prisma.customerAccount.findUnique({ where: { email } })
  if (existing) return { error: "An account with this email already exists" }

  const hashed = await bcrypt.hash(password, 12)
  const token  = generateToken()

  // ── Assign next C number ──────────────────────────────────────
  const lastContact = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Contact"
    WHERE id ~ '^C[0-9]+$'
    ORDER BY LENGTH(id) DESC, id DESC
    LIMIT 1
  `
  const lastNum   = lastContact.length > 0 ? parseInt(lastContact[0].id.slice(1), 10) : 0
  const contactId = `C${String(lastNum + 1).padStart(3, "0")}`

  await prisma.$transaction(async (tx) => {
    await tx.contact.create({
      data: {
        id:          contactId,
        name:        `${firstName} ${lastName}`,
        email,
        phone:       phone ?? undefined,
        addressLine1: shippingLine1 ?? undefined,
        addressLine2: shippingLine2 ?? undefined,
        postcode:    shippingPostcode ?? undefined,
        isBuyer:     true,
      },
    })

    await tx.customerAccount.create({
      data: {
        email,
        password:     hashed,
        firstName,
        lastName,
        phone,
        sessionToken: token,
        contactId,
        shippingLine1, shippingLine2, shippingCity, shippingCounty, shippingPostcode,
        billingLine1,  billingLine2,  billingCity,  billingCounty,  billingPostcode,
        billingSameAsShipping: billingSame,
      },
    })
  })

  const cookieStore = await cookies()
  cookieStore.set("customer-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  })

  redirect("/account")
}

export async function loginCustomer(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const email    = str(formData, "email").toLowerCase()
  const password = str(formData, "password")

  const account = await prisma.customerAccount.findUnique({ where: { email } })
  if (!account) return { error: "Invalid email or password" }

  const valid = await bcrypt.compare(password, account.password)
  if (!valid) return { error: "Invalid email or password" }

  const token = generateToken()
  await prisma.customerAccount.update({
    where: { id: account.id },
    data: { sessionToken: token },
  })

  const cookieStore = await cookies()
  cookieStore.set("customer-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  })

  redirect("/account")
}

export async function logoutCustomer(): Promise<void> {
  const cookieStore = await cookies()
  const token = cookieStore.get("customer-token")?.value

  if (token) {
    await prisma.customerAccount.updateMany({
      where: { sessionToken: token },
      data: { sessionToken: null },
    })
    cookieStore.delete("customer-token")
  }

  redirect("/portal/login")
}

export async function updateCustomerDetails(
  _prev: { error: string } | { success: string } | null,
  formData: FormData,
): Promise<{ error: string } | { success: string }> {
  const cookieStore = await cookies()
  const token = cookieStore.get("customer-token")?.value
  if (!token) return { error: "Not logged in" }

  const account = await prisma.customerAccount.findUnique({ where: { sessionToken: token } })
  if (!account) return { error: "Session expired" }

  const firstName = str(formData, "firstName")
  const lastName  = str(formData, "lastName")
  const phone     = optStr(formData, "phone")

  if (!firstName || !lastName) return { error: "Name is required" }

  // Shipping
  const shippingLine1    = optStr(formData, "shippingLine1")
  const shippingLine2    = optStr(formData, "shippingLine2")
  const shippingCity     = optStr(formData, "shippingCity")
  const shippingCounty   = optStr(formData, "shippingCounty")
  const shippingPostcode = optStr(formData, "shippingPostcode")

  // Billing
  const billingSame     = formData.get("billingSameAsShipping") === "on"
  const billingLine1    = billingSame ? shippingLine1 : optStr(formData, "billingLine1")
  const billingLine2    = billingSame ? shippingLine2 : optStr(formData, "billingLine2")
  const billingCity     = billingSame ? shippingCity  : optStr(formData, "billingCity")
  const billingCounty   = billingSame ? shippingCounty : optStr(formData, "billingCounty")
  const billingPostcode = billingSame ? shippingPostcode : optStr(formData, "billingPostcode")

  // Password change
  const newPassword     = str(formData, "newPassword")
  const currentPassword = str(formData, "currentPassword")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = {
    firstName, lastName, phone,
    shippingLine1, shippingLine2, shippingCity, shippingCounty, shippingPostcode,
    billingLine1,  billingLine2,  billingCity,  billingCounty,  billingPostcode,
    billingSameAsShipping: billingSame,
  }

  if (newPassword) {
    if (!currentPassword) return { error: "Enter your current password to set a new one" }
    const valid = await bcrypt.compare(currentPassword, account.password)
    if (!valid) return { error: "Current password is incorrect" }
    if (newPassword.length < 8) return { error: "New password must be at least 8 characters" }
    updateData.password = await bcrypt.hash(newPassword, 12)
  }

  await prisma.$transaction(async (tx) => {
    await tx.customerAccount.update({ where: { id: account.id }, data: updateData })

    // Keep Contact in sync
    if (account.contactId) {
      await tx.contact.update({
        where: { id: account.contactId },
        data: {
          name:        `${firstName} ${lastName}`,
          phone:       phone ?? undefined,
          addressLine1: shippingLine1 ?? undefined,
          addressLine2: shippingLine2 ?? undefined,
          postcode:    shippingPostcode ?? undefined,
        },
      })
    }
  })

  return { success: "Details updated successfully" }
}
