-- CreateTable
CREATE TABLE "CommissionBid" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "maxBid" INTEGER NOT NULL,
    "contactId" TEXT,
    "notes" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionBid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionBid_lotId_customerAccountId_key" ON "CommissionBid"("lotId", "customerAccountId");

-- AddForeignKey
ALTER TABLE "CommissionBid" ADD CONSTRAINT "CommissionBid_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "CatalogueLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionBid" ADD CONSTRAINT "CommissionBid_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
