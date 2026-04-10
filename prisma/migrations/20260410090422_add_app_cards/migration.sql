-- CreateTable
CREATE TABLE "AppCard" (
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "description" TEXT,

    CONSTRAINT "AppCard_pkey" PRIMARY KEY ("key")
);
