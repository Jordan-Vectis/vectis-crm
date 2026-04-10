-- DropForeignKey
ALTER TABLE "WarehouseReceipt" DROP CONSTRAINT IF EXISTS "WarehouseReceipt_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Submission" DROP CONSTRAINT IF EXISTS "Submission_customerId_fkey";

-- CreateTable
CREATE TABLE IF NOT EXISTS "Contact" (
    "id" TEXT NOT NULL,
    "salutation" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "postcode" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- AlterTable Submission
ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "Submission" ALTER COLUMN "customerId" DROP NOT NULL;

-- AlterTable WarehouseReceipt
ALTER TABLE "WarehouseReceipt" ADD COLUMN IF NOT EXISTS "contactId" TEXT;
ALTER TABLE "WarehouseReceipt" ALTER COLUMN "customerId" DROP NOT NULL;

-- DropTable
DROP TABLE IF EXISTS "WarehouseCustomer";

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReceipt" ADD CONSTRAINT "WarehouseReceipt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
