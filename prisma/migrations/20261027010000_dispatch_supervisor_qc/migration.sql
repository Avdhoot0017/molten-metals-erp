-- Who supervised the load out, and who passed it on quality.
--
-- Both columns are nullable and both foreign keys are ON DELETE SET NULL:
-- notes recorded before this was asked for have no answer, and removing an
-- employee row must never erase the record that castings left the yard.
-- Additive only - nothing here reads, rewrites or removes an existing row, so
-- it is safe to replay.

ALTER TABLE "dispatches" ADD COLUMN IF NOT EXISTS "supervisorId" TEXT;
ALTER TABLE "dispatches" ADD COLUMN IF NOT EXISTS "qcCheckedById" TEXT;

CREATE INDEX IF NOT EXISTS "dispatches_supervisorId_idx" ON "dispatches"("supervisorId");
CREATE INDEX IF NOT EXISTS "dispatches_qcCheckedById_idx" ON "dispatches"("qcCheckedById");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatches_supervisorId_fkey'
  ) THEN
    ALTER TABLE "dispatches"
      ADD CONSTRAINT "dispatches_supervisorId_fkey"
      FOREIGN KEY ("supervisorId") REFERENCES "employees"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'dispatches_qcCheckedById_fkey'
  ) THEN
    ALTER TABLE "dispatches"
      ADD CONSTRAINT "dispatches_qcCheckedById_fkey"
      FOREIGN KEY ("qcCheckedById") REFERENCES "employees"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
