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

export async function registerCustomer(
  _prev: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const email     = (formData.get("email") as string).toLowerCase().trim()
  const password  = formData.get("password") as string
  const firstName = (formData.get("firstName") as string).trim()
  const lastName  = (formData.get("lastName") as string).trim()

  if (!email || !password || !firstName || !lastName) {
    return { error: "All fields are required" }
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" }
  }

  const existing = await prisma.customerAccount.findUnique({ where: { email } })
  if (existing) return { error: "An account with this email already exists" }

  const hashed = await bcrypt.hash(password, 12)
  const token  = generateToken()

  // ── Assign next C number ──────────────────────────────────────
  // Contact IDs for website customers follow the pattern C001, C002, ...
  const lastContact = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Contact"
    WHERE id ~ '^C[0-9]+$'
    ORDER BY LENGTH(id) DESC, id DESC
    LIMIT 1
  `
  const lastNum  = lastContact.length > 0 ? parseInt(lastContact[0].id.slice(1), 10) : 0
  const nextNum  = lastNum + 1
  const contactId = `C${String(nextNum).padStart(3, "0")}`

  // Create the Contact record first, then the CustomerAccount linked to it
  await prisma.$transaction(async (tx) => {
    await tx.contact.create({
      data: {
        id:       contactId,
        name:     `${firstName} ${lastName}`,
        email,
        isBuyer:  true,
      },
    })

    await tx.customerAccount.create({
      data: {
        email,
        password:     hashed,
        firstName,
        lastName,
        sessionToken: token,
        contactId,
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
  const email    = (formData.get("email") as string).toLowerCase().trim()
  const password = formData.get("password") as string

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

  const firstName = (formData.get("firstName") as string).trim()
  const lastName  = (formData.get("lastName") as string).trim()
  const newPassword = formData.get("newPassword") as string
  const currentPassword = formData.get("currentPassword") as string

  if (!firstName || !lastName) return { error: "Name is required" }

  const updateData: Record<string, string> = { firstName, lastName }

  if (newPassword) {
    if (!currentPassword) return { error: "Enter your current password to set a new one" }
    const valid = await bcrypt.compare(currentPassword, account.password)
    if (!valid) return { error: "Current password is incorrect" }
    if (newPassword.length < 8) return { error: "New password must be at least 8 characters" }
    updateData.password = await bcrypt.hash(newPassword, 12)
  }

  await prisma.customerAccount.update({ where: { id: account.id }, data: updateData })

  return { success: "Details updated" }
}
