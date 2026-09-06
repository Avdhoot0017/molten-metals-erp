-- An employee works several parts in a shift, but a fettling record could only
-- name one. The per-part figures move into their own table, leaving the parent
-- holding the day's totals - the same shape production batches already use.

CREATE TABLE "fettling_activity_items" (
  "id"             TEXT NOT NULL,
  "activityId"     TEXT NOT NULL,
  "partId"         TEXT NOT NULL,
  "partsCompleted" INTEGER NOT NULL,
  "partsRejected"  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "fettling_activity_items_pkey" PRIMARY KEY ("id")
);

-- A part appears once per day's record; a second entry would be ambiguous
CREATE UNIQUE INDEX "fettling_activity_items_activityId_partId_key"
  ON "fettling_activity_items"("activityId", "partId");
CREATE INDEX "fettling_activity_items_activityId_idx"
  ON "fettling_activity_items"("activityId");
CREATE INDEX "fettling_activity_items_partId_idx"
  ON "fettling_activity_items"("partId");

ALTER TABLE "fettling_activity_items"
  ADD CONSTRAINT "fettling_activity_items_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "fettling_activities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fettling_activity_items"
  ADD CONSTRAINT "fettling_activity_items_partId_fkey"
  FOREIGN KEY ("partId") REFERENCES "parts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Carry every existing record across. Rows that named a part become a single
-- item holding that day's figures; rows with no part had nothing to move, and
-- keep their totals on the parent with no breakdown.
INSERT INTO "fettling_activity_items" ("id", "activityId", "partId", "partsCompleted", "partsRejected")
SELECT
  md5(random()::text || clock_timestamp()::text),
  "id",
  "partId",
  "partsCompleted",
  "partsRejected"
FROM "fettling_activities"
WHERE "partId" IS NOT NULL;

-- The parent's own part reference is now the items' job
ALTER TABLE "fettling_activities" DROP CONSTRAINT IF EXISTS "fettling_activities_partId_fkey";
ALTER TABLE "fettling_activities" DROP COLUMN "partId";
