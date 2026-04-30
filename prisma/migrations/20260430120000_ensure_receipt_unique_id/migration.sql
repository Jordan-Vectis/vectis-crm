-- Ensure receiptUniqueId column exists (idempotent re-run of split_receipt_unique_id)
ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "receiptUniqueId" TEXT;
