-- Add barcode as a separate field, copy existing lotNumber values into it
ALTER TABLE "CatalogueLot" ADD COLUMN "barcode" TEXT;
UPDATE "CatalogueLot" SET "barcode" = "lotNumber" WHERE "lotNumber" IS NOT NULL AND "lotNumber" != '';
