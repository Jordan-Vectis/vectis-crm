-- CreateTable
CREATE TABLE IF NOT EXISTS "ResearchLog" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "userName"   TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "startedAt"  TIMESTAMP(3) NOT NULL,
    "savedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ResearchLog_userId_idx" ON "ResearchLog"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ResearchLog_savedAt_idx" ON "ResearchLog"("savedAt");
