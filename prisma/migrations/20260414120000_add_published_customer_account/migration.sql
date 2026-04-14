-- Add published flag to CatalogueAuction
ALTER TABLE "CatalogueAuction" ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT false;

-- Create CustomerAccount table
CREATE TABLE "CustomerAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "sessionToken" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerAccount_email_key" ON "CustomerAccount"("email");
CREATE UNIQUE INDEX "CustomerAccount_sessionToken_key" ON "CustomerAccount"("sessionToken");
CREATE UNIQUE INDEX "CustomerAccount_contactId_key" ON "CustomerAccount"("contactId");

ALTER TABLE "CustomerAccount" ADD CONSTRAINT "CustomerAccount_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
