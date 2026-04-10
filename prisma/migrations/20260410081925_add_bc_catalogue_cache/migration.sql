-- CreateTable
CREATE TABLE "BCCatalogueDay" (
    "date" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BCCatalogueDay_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "BCCatalogueEntry" (
    "date" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "BCCatalogueEntry_pkey" PRIMARY KEY ("date","userId")
);

-- CreateIndex
CREATE INDEX "BCCatalogueEntry_date_idx" ON "BCCatalogueEntry"("date");
