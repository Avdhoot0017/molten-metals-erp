-- A batch is entered in three stages, so it needs a status.
--
-- The default is COMPLETED, which backfills every existing record: those were
-- all entered through the single-form flow, so they are finished batches. Only
-- records created by the new staged flow start at PENDING.
CREATE TYPE "ProductionStatus" AS ENUM ('PENDING', 'UPDATED', 'COMPLETED');

ALTER TABLE "production_records"
  ADD COLUMN "status" "ProductionStatus" NOT NULL DEFAULT 'COMPLETED';

-- Output counts are unknown until the castings are counted at completion, so
-- they need defaults rather than staying NOT NULL with no value.
ALTER TABLE "production_records" ALTER COLUMN "quantityProduced" SET DEFAULT 0;
ALTER TABLE "production_records" ALTER COLUMN "goodParts" SET DEFAULT 0;
