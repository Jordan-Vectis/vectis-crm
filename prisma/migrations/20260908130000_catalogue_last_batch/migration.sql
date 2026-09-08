-- The tote/vendor/receipt a cataloguer was last on, per SALE rather than one slot per person.
CREATE TABLE IF NOT EXISTS "CatalogueLastBatch" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "tote"      TEXT,
    "vendor"    TEXT,
    "receipt"   TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CatalogueLastBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogueLastBatch_userId_auctionId_key" ON "CatalogueLastBatch"("userId", "auctionId");
CREATE INDEX IF NOT EXISTS "CatalogueLastBatch_userId_idx" ON "CatalogueLastBatch"("userId");
