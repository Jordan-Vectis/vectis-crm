-- 🔎 Website Search spelling help. See lib/search-words.ts.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS "SearchWord" (
    "word" TEXT NOT NULL,
    "n"    INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SearchWord_pkey" PRIMARY KEY ("word")
  );
CREATE INDEX IF NOT EXISTS "SearchWord_word_trgm_idx" ON "SearchWord" USING gin ("word" gin_trgm_ops);
CREATE TABLE IF NOT EXISTS "SearchWordState" (
    "id"            TEXT NOT NULL,
    "builtAt"       TIMESTAMP(3),
    "words"         INTEGER NOT NULL DEFAULT 0,
    "buildingSince" TIMESTAMP(3),
    "error"         TEXT,
    CONSTRAINT "SearchWordState_pkey" PRIMARY KEY ("id")
  );
