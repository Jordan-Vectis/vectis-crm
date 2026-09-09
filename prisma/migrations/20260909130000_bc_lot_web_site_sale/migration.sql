-- Which of the website's own sale numbers a lot came from, so the Hub knows where the
-- collection got to and the next run can start from the sale after it.
ALTER TABLE "BcLotWeb" ADD COLUMN IF NOT EXISTS "siteSaleId" INTEGER;
CREATE INDEX IF NOT EXISTS "BcLotWeb_siteSaleId_idx" ON "BcLotWeb"("siteSaleId");
