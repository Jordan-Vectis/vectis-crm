"use server"

import { prisma } from "@/lib/prisma"

export async function submitPublicForm(formData: FormData) {
  const title = formData.get("title") as string
  const firstName = formData.get("firstName") as string
  const lastName = formData.get("lastName") as string
  const email = formData.get("email") as string
  const phone = formData.get("phone") as string | null
  const description = formData.get("description") as string
  const uploadedKeys = formData.getAll("photoKey") as string[]

  const name = `${title} ${firstName} ${lastName}`.trim()

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

  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } })
  if (!adminUser) throw new Error("No admin user found")

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
