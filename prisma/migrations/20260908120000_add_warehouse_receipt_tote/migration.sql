-- BC's own truth about which receipt a tote is on.
-- EVA_TOT_ReceiptTote is keyed on (Receipt No., Line No.), so one tote number can sit on several
-- receipts. WarehouseTote is unique on toteNo and therefore keeps only one of them.
-- Deliberately a separate table: every existing check reads WarehouseTote and must not change.
CREATE TABLE IF NOT EXISTS "WarehouseReceiptTote" (
    "id"          TEXT NOT NULL,
    "bcSystemId"  TEXT NOT NULL,
    "receiptNo"   TEXT NOT NULL,
    "toteNo"      TEXT NOT NULL,
    "lineNo"      INTEGER,
    "vendorNo"    TEXT,
    "vendorName"  TEXT,
    "catalogued"  BOOLEAN NOT NULL DEFAULT false,
    "bcCreatedAt" TIMESTAMP(3),
    "syncedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarehouseReceiptTote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WarehouseReceiptTote_bcSystemId_key" ON "WarehouseReceiptTote"("bcSystemId");
CREATE INDEX IF NOT EXISTS "WarehouseReceiptTote_toteNo_idx" ON "WarehouseReceiptTote"("toteNo");
CREATE INDEX IF NOT EXISTS "WarehouseReceiptTote_receiptNo_idx" ON "WarehouseReceiptTote"("receiptNo");
CREATE INDEX IF NOT EXISTS "WarehouseReceiptTote_toteNo_catalogued_idx" ON "WarehouseReceiptTote"("toteNo", "catalogued");
