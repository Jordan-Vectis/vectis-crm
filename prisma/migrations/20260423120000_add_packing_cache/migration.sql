CREATE TABLE IF NOT EXISTS "BCPackingDay" (
    "date" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BCPackingDay_pkey" PRIMARY KEY ("date")
);

CREATE TABLE IF NOT EXISTS "BCPackingEntry" (
    "date" TEXT NOT NULL,
    "staff" TEXT NOT NULL,
    "docNo" TEXT NOT NULL,
    "lotCount" INTEGER NOT NULL,
    CONSTRAINT "BCPackingEntry_pkey" PRIMARY KEY ("date","staff","docNo")
);

CREATE INDEX IF NOT EXISTS "BCPackingEntry_date_idx" ON "BCPackingEntry"("date");
