-- A country the Hub worked out for a vendor Business Central holds none for.
ALTER TABLE "BcVendor" ADD COLUMN IF NOT EXISTS "resolvedCountry" TEXT;
ALTER TABLE "BcVendor" ADD COLUMN IF NOT EXISTS "resolvedBy"      TEXT;
ALTER TABLE "BcVendor" ADD COLUMN IF NOT EXISTS "resolvedNote"    TEXT;
ALTER TABLE "BcVendor" ADD COLUMN IF NOT EXISTS "resolvedAt"      TIMESTAMP(3);
