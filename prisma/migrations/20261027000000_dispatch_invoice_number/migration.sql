-- Invoice number on an outward note.
--
-- Additive and nullable: existing dispatches keep every value they have and
-- simply read NULL here, which is also the honest answer for a load that went
-- out on a challan and has not been invoiced yet. Nothing is read, written or
-- removed, so this is safe to replay.

ALTER TABLE "dispatches" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;

-- Deliberately not unique: one invoice can cover several loads, and numbers
-- repeat across financial years. The index is only to look a load up by the
-- number on the bill.
CREATE INDEX IF NOT EXISTS "dispatches_invoiceNumber_idx" ON "dispatches"("invoiceNumber");
