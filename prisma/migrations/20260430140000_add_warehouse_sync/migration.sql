-- CreateTable: WarehouseItem
CREATE TABLE "WarehouseItem" (
  "id"                TEXT NOT NULL,
  "uniqueId"          TEXT NOT NULL,
  "receiptNo"         TEXT,
  "articleNo"         TEXT,
  "stockNo"           TEXT,
  "barcode"           TEXT,
  "description"       TEXT,
  "artist"            TEXT,
  "category"          TEXT,
  "subcategory"       TEXT,
  "vendorNo"          TEXT,
  "vendorName"        TEXT,
  "vendorEmail"       TEXT,
  "auctionCode"       TEXT,
  "auctionDate"       TEXT,
  "lotNo"             TEXT,
  "currentLotNo"      TEXT,
  "lowEstimate"       DOUBLE PRECISION,
  "highEstimate"      DOUBLE PRECISION,
  "hammerPrice"       DOUBLE PRECISION,
  "reservePrice"      DOUBLE PRECISION,
  "location"          TEXT,
  "binCode"           TEXT,
  "toteNo"            TEXT,
  "locationScannedAt" TIMESTAMP(3),
  "catalogued"        BOOLEAN,
  "cataloguedBy"      TEXT,
  "cataloguedAt"      TIMESTAMP(3),
  "noOfPhotos"        INTEGER,
  "goodsReceived"     BOOLEAN,
  "goodsReceivedDate" TIMESTAMP(3),
  "collected"         BOOLEAN,
  "withdrawLot"       BOOLEAN,
  "bcModifiedAt"      TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarehouseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WarehouseSyncLog
CREATE TABLE "WarehouseSyncLog" (
  "id"             TEXT NOT NULL,
  "source"         TEXT NOT NULL,
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"    TIMESTAMP(3),
  "status"         TEXT NOT NULL DEFAULT 'running',
  "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
  "lastTimestamp"  TEXT,
  "error"          TEXT,
  CONSTRAINT "WarehouseSyncLog_pkey" PRIMARY KEY ("id")
);

-- Unique & indexes
CREATE UNIQUE INDEX "WarehouseItem_uniqueId_key" ON "WarehouseItem"("uniqueId");
CREATE INDEX "WarehouseItem_auctionCode_idx" ON "WarehouseItem"("auctionCode");
CREATE INDEX "WarehouseItem_location_idx"    ON "WarehouseItem"("location");
CREATE INDEX "WarehouseItem_toteNo_idx"      ON "WarehouseItem"("toteNo");
CREATE INDEX "WarehouseItem_barcode_idx"     ON "WarehouseItem"("barcode");
