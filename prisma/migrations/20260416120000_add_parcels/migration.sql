-- CreateTable Parcel
CREATE TABLE IF NOT EXISTS "Parcel" (
    "id"                  TEXT NOT NULL,
    "reference"           TEXT NOT NULL,
    "status"              TEXT NOT NULL DEFAULT 'PENDING',
    "recipientName"       TEXT NOT NULL,
    "recipientCompany"    TEXT,
    "recipientLine1"      TEXT NOT NULL,
    "recipientLine2"      TEXT,
    "recipientCity"       TEXT NOT NULL,
    "recipientCounty"     TEXT,
    "recipientPostcode"   TEXT NOT NULL,
    "recipientCountry"    TEXT NOT NULL DEFAULT 'GB',
    "recipientEmail"      TEXT,
    "recipientPhone"      TEXT,
    "weightInGrams"       INTEGER NOT NULL DEFAULT 500,
    "packageFormat"       TEXT NOT NULL DEFAULT 'Parcel',
    "serviceCode"         TEXT NOT NULL DEFAULT 'TPP48',
    "specialInstructions" TEXT,
    "notes"               TEXT,
    "rmOrderIdentifier"   TEXT,
    "trackingNumber"      TEXT,
    "labelPdf"            TEXT,
    "manifestId"          TEXT,
    "despatchedAt"        TIMESTAMP(3),
    "customerAccountId"   TEXT,
    "createdByName"       TEXT,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Parcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable ParcelLot
CREATE TABLE IF NOT EXISTS "ParcelLot" (
    "id"       TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "lotId"    TEXT NOT NULL,

    CONSTRAINT "ParcelLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Parcel_reference_key" ON "Parcel"("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "ParcelLot_parcelId_lotId_key" ON "ParcelLot"("parcelId", "lotId");

-- AddForeignKey
ALTER TABLE "Parcel" DROP CONSTRAINT IF EXISTS "Parcel_customerAccountId_fkey";
ALTER TABLE "Parcel" ADD CONSTRAINT "Parcel_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "CustomerAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ParcelLot" DROP CONSTRAINT IF EXISTS "ParcelLot_parcelId_fkey";
ALTER TABLE "ParcelLot" ADD CONSTRAINT "ParcelLot_parcelId_fkey"
    FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ParcelLot" DROP CONSTRAINT IF EXISTS "ParcelLot_lotId_fkey";
ALTER TABLE "ParcelLot" ADD CONSTRAINT "ParcelLot_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "CatalogueLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
