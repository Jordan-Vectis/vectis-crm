-- 🔎 Website Search spelling list v2. See lib/search-words.ts.
ALTER TABLE "SearchWord" ADD COLUMN IF NOT EXISTS "forms" TEXT[];
ALTER TABLE "SearchWordState" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
CREATE UNLOGGED TABLE IF NOT EXISTS "SearchWordBuild" (
    "raw" TEXT NOT NULL,
    "n"   INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SearchWordBuild_pkey" PRIMARY KEY ("raw")
  );
