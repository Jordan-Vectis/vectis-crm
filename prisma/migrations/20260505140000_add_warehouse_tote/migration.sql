-- CreateTable
CREATE TABLE "WarehouseTote" (
    "id" TEXT NOT NULL,
    "toteNo" TEXT NOT NULL,
    "location" TEXT,
    "binCode" TEXT,
    "receiptNo" TEXT,
    "vendorNo" TEXT,
    "vendorName" TEXT,
    "status" TEXT,
    "bcModifiedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseTote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseTote_toteNo_key" ON "WarehouseTote"("toteNo");

-- CreateIndex
CREATE INDEX "WarehouseTote_location_idx" ON "WarehouseTote"("location");

-- CreateIndex
CREATE INDEX "WarehouseTote_toteNo_idx" ON "WarehouseTote"("toteNo");
