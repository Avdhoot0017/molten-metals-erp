-- The daily entry sheet keeps one row per employee per working day and upserts
-- on this pair, so enforce it at the database level.
DROP INDEX IF EXISTS "fettling_activities_employeeId_date_idx";

CREATE UNIQUE INDEX "fettling_activities_employeeId_date_key"
  ON "fettling_activities"("employeeId", "date");
