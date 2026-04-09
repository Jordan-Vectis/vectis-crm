-- CreateTable
CREATE TABLE "AiPreset" (
    "key" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiPreset_pkey" PRIMARY KEY ("key")
);
