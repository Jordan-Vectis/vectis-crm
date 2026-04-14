/**
 * Migration: Unify Customer + WarehouseCustomer → Contact
 *
 * Run with: npx tsx scripts/migrate-contacts.ts
 */

import { config } from "dotenv"
import { resolve } from "path"
config({ path: resolve(__dirname, "../.env") })

import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

function padContactId(n: number): string {
  return `c${String(n).padStart(5, "0")}`
}

async function main() {
  console.log("Starting contact migration...")

  // 1. Load all existing warehouse customers
  const warehouseCustomers = await prisma.warehouseCustomer.findMany()
  console.log(`Found ${warehouseCustomers.length} warehouse customers`)

  // 2. Load all existing CRM customers
  const crmCustomers = await prisma.customer.findMany()
  console.log(`Found ${crmCustomers.length} CRM customers`)

  // 3. Create Contact records from WarehouseCustomers (keep same IDs)
  for (const wc of warehouseCustomers) {
    const exists = await prisma.contact.findUnique({ where: { id: wc.id } })
    if (!exists) {
      await prisma.contact.create({
        data: {
          id: wc.id,
          salutation: wc.salutation,
          name: wc.name,
          email: wc.email,
          phone: wc.phone,
          addressLine1: wc.addressLine1,
          addressLine2: wc.addressLine2,
          postcode: wc.postcode,
          notes: wc.notes,
          createdAt: wc.createdAt,
          updatedAt: wc.updatedAt,
        },
      })
      console.log(`  Created contact from warehouse customer: ${wc.id} (${wc.name})`)
    } else {
      console.log(`  Contact already exists: ${wc.id} — skipping`)
    }
  }

  // 4. Find highest existing contact number to continue sequence
  const allContacts = await prisma.contact.findMany({ select: { id: true } })
  let maxNum = 0
  for (const c of allContacts) {
    const num = parseInt(c.id.replace(/^\D+/, ""), 10)
    if (!isNaN(num) && num > maxNum) maxNum = num
  }

  // 5. Create Contact records from CRM Customers (assign new IDs)
  //    Build a map from old CRM customerId → new contactId
  const crmToContactId: Record<string, string> = {}
  for (const cc of crmCustomers) {
    // Check if a contact with matching email already exists (from warehouse)
    let existingContact = cc.email
      ? await prisma.contact.findFirst({ where: { email: cc.email } })
      : null

    if (existingContact) {
      crmToContactId[cc.id] = existingContact.id
      console.log(`  Matched CRM customer ${cc.name} to existing contact ${existingContact.id} by email`)
    } else {
      maxNum++
      const newId = padContactId(maxNum)
      await prisma.contact.create({
        data: {
          id: newId,
          name: cc.name,
          email: cc.email,
          phone: cc.phone,
          createdAt: cc.createdAt,
          updatedAt: cc.updatedAt,
        },
      })
      crmToContactId[cc.id] = newId
      console.log(`  Created contact from CRM customer: ${newId} (${cc.name})`)
    }
  }

  // 6. Update WarehouseReceipt.contactId from old customerId
  const wReceipts = await prisma.warehouseReceipt.findMany({ where: { contactId: null } })
  console.log(`\nUpdating ${wReceipts.length} warehouse receipts...`)
  for (const r of wReceipts) {
    await prisma.warehouseReceipt.update({
      where: { id: r.id },
      data: { contactId: r.customerId },
    })
  }

  // 7. Update Submission.contactId from old customerId → new contactId
  const submissions = await prisma.submission.findMany({ where: { contactId: null } })
  console.log(`Updating ${submissions.length} submissions...`)
  for (const s of submissions) {
    const contactId = crmToContactId[s.customerId]
    if (contactId) {
      await prisma.submission.update({
        where: { id: s.id },
        data: { contactId },
      })
    } else {
      console.warn(`  WARNING: No contact found for submission ${s.id} (customerId: ${s.customerId})`)
    }
  }

  console.log("\nMigration complete!")
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
