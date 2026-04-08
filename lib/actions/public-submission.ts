"use server"

import { prisma } from "@/lib/prisma"
import { uploadToR2 } from "@/lib/r2"

export async function submitPublicForm(formData: FormData) {
  const title = formData.get("title") as string
  const firstName = formData.get("firstName") as string
  const lastName = formData.get("lastName") as string
  const email = formData.get("email") as string
  const phone = formData.get("phone") as string | null
  const description = formData.get("description") as string
  const files = formData.getAll("photos") as File[]

  const name = `${title} ${firstName} ${lastName}`.trim()

  // Upload photos to R2
  const uploadedKeys: string[] = []
  for (const file of files) {
    if (file.size === 0) continue
    const buffer = Buffer.from(await file.arrayBuffer())
    const key = await uploadToR2(buffer, file.name, file.type)
    uploadedKeys.push(key)
  }

  // Find or create customer
  let customer = await prisma.customer.findFirst({
    where: { email: email || undefined },
  })

  if (!customer) {
    customer = await prisma.customer.create({
      data: { name, email: email || null, phone: phone || null },
    })
  } else {
    await prisma.customer.update({
      where: { id: customer.id },
      data: { name, phone: phone || null },
    })
  }

  // Find a system user to attribute creation to (first admin)
  const adminUser = await prisma.user.findFirst({
    where: { role: "ADMIN" },
  })

  if (!adminUser) throw new Error("No admin user found")

  // Create submission with one item containing the description and photo keys
  await prisma.submission.create({
    data: {
      channel: "WEB_FORM",
      customerId: customer.id,
      createdById: adminUser.id,
      items: {
        create: {
          name: "Web form submission",
          description,
          imageUrls: uploadedKeys,
        },
      },
    },
  })
}
