CREATE TABLE IF NOT EXISTS "CataloguePhotoSession" (
  "id" TEXT NOT NULL,
  "auctionId" TEXT NOT NULL,
  "lotBarcode" TEXT,
  "customerRef" TEXT,
  "barcodePhotoKey" TEXT,
  "itemPhotoKeys" TEXT[] NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CataloguePhotoSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CataloguePhotoSession"
  ADD CONSTRAINT "CataloguePhotoSession_auctionId_fkey"
  FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
