-- Carrying the metal left in a furnace into the next heat.
--
-- A heat charged with 300 kg that pours 150 kg into moulds leaves 150 kg
-- molten in the furnace. Until now there was nowhere to record that, so the
-- next batch either looked like it came from nothing or the leftover was
-- charged again from stock - metal the system had already deducted.
--
-- Additive only. Three new columns, no existing column read or written.
ALTER TABLE "production_records" ADD COLUMN "metalRemaining" DOUBLE PRECISION;
ALTER TABLE "production_records" ADD COLUMN "carriedFromId" TEXT;

-- Every batch already recorded genuinely carried nothing in, so 0 here is the
-- true value rather than a placeholder - unlike "metalRemaining", where nobody
-- wrote down what was left and NULL is the only honest answer.
ALTER TABLE "production_records" ADD COLUMN "carriedInWeight" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- A heel may be claimed by at most one batch. Two batches carrying the same
-- 150 kg would create metal from nothing; NULLs stay unconstrained in Postgres,
-- so any number of batches may carry nothing.
CREATE UNIQUE INDEX "production_records_carriedFromId_key"
  ON "production_records"("carriedFromId");

ALTER TABLE "production_records"
  ADD CONSTRAINT "production_records_carriedFromId_fkey"
  FOREIGN KEY ("carriedFromId") REFERENCES "production_records"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
