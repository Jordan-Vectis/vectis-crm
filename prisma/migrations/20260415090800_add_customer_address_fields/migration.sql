/*
  Warnings:

  - You are about to drop the column `customerId` on the `Submission` table. All the data in the column will be lost.
  - You are about to drop the column `customerId` on the `WarehouseReceipt` table. All the data in the column will be lost.
  - You are about to drop the `Customer` table. If the table is not empty, all the data it contains will be lost.
  - Made the column `contactId` on table `Submission` required. This step will fail if there are existing NULL values in that column.
  - Made the column `contactId` on table `WarehouseReceipt` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT "Submission_contactId_fkey";

-- DropForeignKey
ALTER TABLE "WarehouseReceipt" DROP CONSTRAINT "WarehouseReceipt_contactId_fkey";

-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CustomerAccount" ADD COLUMN     "billingCity" TEXT,
ADD COLUMN     "billingCounty" TEXT,
ADD COLUMN     "billingLine1" TEXT,
ADD COLUMN     "billingLine2" TEXT,
ADD COLUMN     "billingPostcode" TEXT,
ADD COLUMN     "billingSameAsShipping" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "shippingCity" TEXT,
ADD COLUMN     "shippingCounty" TEXT,
ADD COLUMN     "shippingLine1" TEXT,
ADD COLUMN     "shippingLine2" TEXT,
ADD COLUMN     "shippingPostcode" TEXT;

-- AlterTable
ALTER TABLE "Submission" DROP COLUMN "customerId",
ALTER COLUMN "contactId" SET NOT NULL;

-- AlterTable
ALTER TABLE "WarehouseReceipt" DROP COLUMN "customerId",
ALTER COLUMN "contactId" SET NOT NULL;

-- DropTable
DROP TABLE "Customer";

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
