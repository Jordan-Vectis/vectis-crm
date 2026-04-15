/*
  Warnings:

  - You are about to drop the column `customerId` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `customerId` on the `WarehouseReceipt` table. All the data in the column will be lost.
  - You are about to drop the `Customer` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `contactId` on table `Submission` required. This step will fail if there are existing NULL values in that column.
  - Made the column `contactId` on table `WarehouseReceipt` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey (safe)
ALTER TABLE "Submission" DROP CONSTRAINT IF EXISTS "Submission_contactId_fkey";
ALTER TABLE "WarehouseReceipt" DROP CONSTRAINT IF EXISTS "WarehouseReceipt_contactId_fkey";
ALTER TABLE "Submission" DROP CONSTRAINT IF EXISTS "Submission_customerId_fkey";
ALTER TABLE "WarehouseReceipt" DROP CONSTRAINT IF EXISTS "WarehouseReceipt_customerId_fkey";

-- AlterTable Contact (safe)
ALTER TABLE "Contact" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable CustomerAccount — add columns only if they don't exist
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "billingCity" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "billingCounty" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "billingLine1" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "billingLine2" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "billingPostcode" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "billingSameAsShipping" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "shippingCity" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "shippingCounty" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "shippingLine1" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "shippingLine2" TEXT;
ALTER TABLE "CustomerAccount" ADD COLUMN IF NOT EXISTS "shippingPostcode" TEXT;

-- Delete orphaned rows before making contactId NOT NULL
DELETE FROM "Submission" WHERE "contactId" IS NULL;
DELETE FROM "WarehouseReceipt" WHERE "contactId" IS NULL;

-- AlterTable Submission
ALTER TABLE "Submission" DROP COLUMN IF EXISTS "customerId";
ALTER TABLE "Submission" ALTER COLUMN "contactId" SET NOT NULL;

-- AlterTable WarehouseReceipt
ALTER TABLE "WarehouseReceipt" DROP COLUMN IF EXISTS "customerId";
ALTER TABLE "WarehouseReceipt" ALTER COLUMN "contactId" SET NOT NULL;

-- DropTable (safe)
DROP TABLE IF EXISTS "Customer";

-- AddForeignKey (safe — drop first to avoid duplicate constraint error)
ALTER TABLE "Submission" DROP CONSTRAINT IF EXISTS "Submission_contactId_fkey";
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WarehouseReceipt" DROP CONSTRAINT IF EXISTS "WarehouseReceipt_contactId_fkey";
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
