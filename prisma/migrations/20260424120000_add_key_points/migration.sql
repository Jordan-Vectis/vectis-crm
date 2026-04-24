-- Add keyPoints field to CatalogueLot
-- Copies existing description content (cataloguer key points) into the new field
-- so existing lots are not affected
ALTER TABLE "CatalogueLot" ADD COLUMN IF NOT EXISTS "keyPoints" TEXT NOT NULL DEFAULT '';
UPDATE "CatalogueLot" SET "keyPoints" = "description" WHERE "keyPoints" = '';
