-- Idempotent: ensure AuctionLot KP fields exist on Railway DB
ALTER TABLE "AuctionLot" ADD COLUMN IF NOT EXISTS "originalDescription" TEXT;
ALTER TABLE "AuctionLot" ADD COLUMN IF NOT EXISTS "keyPoints" TEXT;
ALTER TABLE "AuctionLot" ADD COLUMN IF NOT EXISTS "missing" TEXT;
ALTER TABLE "AuctionLot" ADD COLUMN IF NOT EXISTS "added" TEXT;
