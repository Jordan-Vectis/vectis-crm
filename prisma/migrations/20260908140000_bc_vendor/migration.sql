-- Vendor (consignor) addresses from Business Central, for BC Reports -> Vendor Locations.
CREATE TABLE IF NOT EXISTS "BcVendor" (
    "id"          TEXT NOT NULL,
    "vendorNo"    TEXT NOT NULL,
    "name"        TEXT,
    "address"     TEXT,
    "address2"    TEXT,
    "city"        TEXT,
    "county"      TEXT,
    "postCode"    TEXT,
    "countryCode" TEXT,
    "source"      TEXT,
    "syncedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BcVendor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BcVendor_vendorNo_key" ON "BcVendor"("vendorNo");
CREATE INDEX IF NOT EXISTS "BcVendor_countryCode_idx" ON "BcVendor"("countryCode");
CREATE INDEX IF NOT EXISTS "BcVendor_postCode_idx" ON "BcVendor"("postCode");
