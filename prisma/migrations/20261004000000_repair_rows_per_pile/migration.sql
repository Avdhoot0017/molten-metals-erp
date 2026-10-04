-- One row per part per day was right while every entry was route work. It is
-- wrong for a repair bench: a welder working a part's rejects from fettling AND
-- the same part's rejects from bending needs a row for each pile, and the
-- second was refused - so that day's work could not be recorded at all.
--
-- The rule splits in two, and both halves are still enforced by the database:
--   route work  - one row per part, as before
--   repair work - one row per part PER PILE it was rejected at
--
-- INDEXES ONLY. Not a single row is read, written, moved or deleted by this
-- migration; it changes what the table will refuse in future, nothing about
-- what it already holds. Verified before writing it that no existing row
-- breaks either new rule.

-- A copy of the table as it stands, in case anything about this needs undoing.
-- Nothing reads it; drop it once the new rules have been seen to work:
--   DROP TABLE "fettling_activity_items_backup_20261004";
CREATE TABLE IF NOT EXISTS "fettling_activity_items_backup_20261004" AS
  SELECT * FROM "fettling_activity_items";

DROP INDEX IF EXISTS "fettling_activity_items_activityId_partId_key";

-- Route work: unchanged in meaning - one row per part in a day's entry.
CREATE UNIQUE INDEX "fettling_items_one_route_row_per_part"
  ON "fettling_activity_items" ("activityId", "partId")
  WHERE "reworkFromStepId" IS NULL;

-- Repair work: one row per pile. Two rows for the same part are fine as long
-- as they repair rejects from different stations; a second row for the SAME
-- pile is still refused, which is what stops the same pieces being counted
-- twice.
CREATE UNIQUE INDEX "fettling_items_one_row_per_repair_pile"
  ON "fettling_activity_items" ("activityId", "partId", "reworkFromStepId")
  WHERE "reworkFromStepId" IS NOT NULL;
