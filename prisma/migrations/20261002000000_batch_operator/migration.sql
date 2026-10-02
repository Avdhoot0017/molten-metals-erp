-- Who was on the furnace for this heat.
--
-- Separate from createdBy, which records whoever typed the batch in - usually
-- a manager writing up someone else's shift. When a batch looks wrong, "who
-- ran it" is the question, and a login name does not answer it.
--
-- Additive and nullable: every batch recorded before this was asked for has no
-- answer, and a made-up one would be worse than a blank. The form requires it
-- for new batches.
ALTER TABLE "production_records" ADD COLUMN "operatorId" TEXT;

CREATE INDEX "production_records_operatorId_idx" ON "production_records"("operatorId");

-- Employees are deactivated rather than deleted, so an operator cannot vanish
-- from a batch's history.
ALTER TABLE "production_records" ADD CONSTRAINT "production_records_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
