-- BC's free-text "Contents Description" for a tote, shown in the lot wizard.
ALTER TABLE "WarehouseTote" ADD COLUMN IF NOT EXISTS "contents" TEXT;
