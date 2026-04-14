-- CreateTable
CREATE TABLE "LiveAuction" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currentLotIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveAuction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveAuction_auctionId_key" ON "LiveAuction"("auctionId");

-- AddForeignKey
ALTER TABLE "LiveAuction" ADD CONSTRAINT "LiveAuction_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
