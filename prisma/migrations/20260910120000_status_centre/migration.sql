-- 🚦 Status Centre + the admin bell (lib/status/, lib/notifications.ts).
CREATE TABLE IF NOT EXISTS "StatusService" (
    "service"       TEXT NOT NULL,
    "state"         TEXT NOT NULL,
    "summary"       TEXT NOT NULL,
    "detail"        JSONB,
    "latencyMs"     INTEGER,
    "since"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOkAt"      TIMESTAMP(3),
    "badSince"      TIMESTAMP(3),
    "failStreak"    INTEGER NOT NULL DEFAULT 0,
    "notifiedState" TEXT,
    CONSTRAINT "StatusService_pkey" PRIMARY KEY ("service")
  );
CREATE TABLE IF NOT EXISTS "StatusCheck" (
    "id"        TEXT NOT NULL,
    "service"   TEXT NOT NULL,
    "state"     TEXT NOT NULL,
    "summary"   TEXT NOT NULL,
    "latencyMs" INTEGER,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StatusCheck_pkey" PRIMARY KEY ("id")
  );
CREATE INDEX IF NOT EXISTS "StatusCheck_service_checkedAt_idx" ON "StatusCheck"("service", "checkedAt");
CREATE INDEX IF NOT EXISTS "StatusCheck_checkedAt_idx" ON "StatusCheck"("checkedAt");
CREATE TABLE IF NOT EXISTS "Notification" (
    "id"        TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "level"     TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "body"      TEXT,
    "href"      TEXT,
    "audience"  TEXT NOT NULL DEFAULT 'ADMIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
  );
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");
CREATE TABLE IF NOT EXISTS "NotificationSeen" (
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationSeen_pkey" PRIMARY KEY ("userId")
  );
