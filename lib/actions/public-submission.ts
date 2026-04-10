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

  // Find or create contact
  let contact = await prisma.contact.findFirst({
    where: { email: email || undefined },
  })

  if (!contact) {
    const contacts = await prisma.contact.findMany({ select: { id: true } })
    let maxNum = 0
    for (const c of contacts) {
      const num = parseInt(c.id.replace(/^\D+/, ""), 10)
      if (!isNaN(num) && num > maxNum) maxNum = num
    }
    const id = `c${String(maxNum + 1).padStart(5, "0")}`
    contact = await prisma.contact.create({
      data: { id, name, email: email || null, phone: phone || null },
    })
  } else {
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: { name, phone: phone || null },
    })
  }

  const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } })
  if (!adminUser) throw new Error("No admin user found")

  await prisma.submission.create({
    data: {
      channel: "WEB_FORM",
      contactId: contact.id,
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
