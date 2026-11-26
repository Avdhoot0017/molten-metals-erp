-- Who supervised the load, and who passed it, become names rather than a pick
-- from the employee list.
--
-- WHY: the person who loads a lorry is often not on the payroll list - a
-- driver, a contractor, somebody covering a shift - and a note that cannot be
-- saved because the name is not in a dropdown does not get written at all.
--
-- SAFETY: additive only. Two new nullable TEXT columns; the existing
-- supervisorId / qcCheckedById columns, their indexes and their foreign keys
-- are all left in place. The backfill only READS the employees table to copy
-- names across, so every note recorded under the old scheme still says who
-- stood behind the load. Guarded, so it is safe to replay.

ALTER TABLE "dispatches" ADD COLUMN IF NOT EXISTS "supervisorName" TEXT;
ALTER TABLE "dispatches" ADD COLUMN IF NOT EXISTS "qcCheckedByName" TEXT;

UPDATE "dispatches" d
SET "supervisorName" = e."name"
FROM "employees" e
WHERE e."id" = d."supervisorId" AND d."supervisorName" IS NULL;

UPDATE "dispatches" d
SET "qcCheckedByName" = e."name"
FROM "employees" e
WHERE e."id" = d."qcCheckedById" AND d."qcCheckedByName" IS NULL;
