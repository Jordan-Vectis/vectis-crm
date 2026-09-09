-- Which database a website job is running for: "abc", "bc" or "both".
ALTER TABLE "ArchiveJob" ADD COLUMN IF NOT EXISTS "scope" TEXT;
