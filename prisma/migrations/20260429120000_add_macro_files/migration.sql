CREATE TABLE IF NOT EXISTS "MacroFile" (
  "id"          TEXT        NOT NULL,
  "name"        TEXT        NOT NULL,
  "filename"    TEXT        NOT NULL,
  "description" TEXT,
  "content"     BYTEA       NOT NULL,
  "mimeType"    TEXT        NOT NULL DEFAULT 'text/plain',
  "size"        INTEGER     NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MacroFile_pkey" PRIMARY KEY ("id")
);
