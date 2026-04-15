-- CreateTable
CREATE TABLE "BidderRegistration" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "contactId" TEXT,
    "acceptedTerms" BOOLEAN NOT NULL DEFAULT true,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidderRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BidderRegistration_auctionId_customerAccountId_key" ON "BidderRegistration"("auctionId", "customerAccountId");

-- AddForeignKey
ALTER TABLE "BidderRegistration" ADD CONSTRAINT "BidderRegistration_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidderRegistration" ADD CONSTRAINT "BidderRegistration_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
