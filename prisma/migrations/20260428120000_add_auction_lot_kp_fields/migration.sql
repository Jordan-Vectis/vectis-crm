-- Add KP Check fields to AuctionLot
-- IF NOT EXISTS used because local DB may already have these from prisma db push
ALTER TABLE "AuctionLot" ADD COLUMN IF NOT EXISTS "originalDescription" TEXT;
ALTER TABLE "AuctionLot" ADD COLUMN IF NOT EXISTS "keyPoints" TEXT;
ALTER TABLE "AuctionLot" ADD COLUMN IF NOT EXISTS "missing" TEXT;
ALTER TABLE "AuctionLot" ADD COLUMN IF NOT EXISTS "added" TEXT;
