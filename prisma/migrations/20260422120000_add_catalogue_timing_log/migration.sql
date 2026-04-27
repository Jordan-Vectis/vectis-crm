-- CreateTable: CatalogueTimingLog
CREATE TABLE IF NOT EXISTS "CatalogueTimingLog" (
    "id"         TEXT NOT NULL,
    "auctionId"  TEXT NOT NULL,
    "lotId"      TEXT,
    "userId"     TEXT NOT NULL,
    "userName"   TEXT NOT NULL,
    "method"     TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "lotNumber"  TEXT,
    "savedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueTimingLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CatalogueTimingLog_auctionId_fkey'
  ) THEN
    ALTER TABLE "CatalogueTimingLog"
      ADD CONSTRAINT "CatalogueTimingLog_auctionId_fkey"
      FOREIGN KEY ("auctionId") REFERENCES "CatalogueAuction"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
