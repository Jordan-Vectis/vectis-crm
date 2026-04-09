-- CreateTable
CREATE TABLE "CatalogueAuction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "auctionDate" TIMESTAMP(3),
    "auctionType" TEXT NOT NULL DEFAULT 'GENERAL',
    "eventName" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "complete" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogueAuction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueLot" (
    "id" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "estimateLow" INTEGER,
    "estimateHigh" INTEGER,
    "reserve" INTEGER,
    "hammerPrice" INTEGER,
    "condition" TEXT,
    "vendor" TEXT,
    "tote" TEXT,
    "receipt" TEXT,
    "category" TEXT,
    "subCategory" TEXT,
    "brand" TEXT,
    "notes" TEXT,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ENTERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "auctionId" TEXT NOT NULL,

    CONSTRAINT "CatalogueLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueAuction_code_key" ON "CatalogueAuction"("code");

-- AddForeignKey
ALTER TABLE "CatalogueLot" ADD CONSTRAINT "CatalogueLot_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
