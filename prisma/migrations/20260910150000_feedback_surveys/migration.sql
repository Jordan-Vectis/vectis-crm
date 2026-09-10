-- 📝 Feedback surveys (Admin → Feedback). See lib/feedback.ts.
CREATE TABLE IF NOT EXISTS "FeedbackSurvey" (
    "id"              TEXT NOT NULL,
    "title"           TEXT NOT NULL,
    "intro"           TEXT,
    "questions"       JSONB NOT NULL DEFAULT '[]',
    "status"          TEXT NOT NULL DEFAULT 'DRAFT',
    "audienceRoles"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "audienceUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdById"     TEXT,
    "createdByName"   TEXT,
    "openedAt"        TIMESTAMP(3),
    "closedAt"        TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedbackSurvey_pkey" PRIMARY KEY ("id")
  );
CREATE INDEX IF NOT EXISTS "FeedbackSurvey_status_idx" ON "FeedbackSurvey"("status");
CREATE TABLE IF NOT EXISTS "FeedbackResponse" (
    "id"          TEXT NOT NULL,
    "surveyId"    TEXT NOT NULL,
    "userId"      TEXT NOT NULL,
    "userName"    TEXT,
    "status"      TEXT NOT NULL,
    "answers"     JSONB NOT NULL DEFAULT '[]',
    "submittedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FeedbackResponse_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FeedbackResponse_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "FeedbackSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
CREATE UNIQUE INDEX IF NOT EXISTS "FeedbackResponse_surveyId_userId_key" ON "FeedbackResponse"("surveyId", "userId");
CREATE INDEX IF NOT EXISTS "FeedbackResponse_userId_idx" ON "FeedbackResponse"("userId");
