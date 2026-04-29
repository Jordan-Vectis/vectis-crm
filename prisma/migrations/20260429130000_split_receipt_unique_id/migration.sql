-- Add receiptUniqueId column
ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "receiptUniqueId" TEXT;

-- Migrate existing data: move the full "R007523-1" value into receiptUniqueId
-- and strip the suffix from receipt so it just holds "R007523"
UPDATE "CatalogueLot"
SET
  "receiptUniqueId" = "receipt",
  "receipt"         = REGEXP_REPLACE("receipt", '-[0-9]+$', '')
WHERE "receipt" IS NOT NULL
  AND "receipt" ~ '^.+-[0-9]+$';
