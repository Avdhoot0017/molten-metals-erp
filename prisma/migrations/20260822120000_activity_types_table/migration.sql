-- Fettling operations move from a hardcoded enum to an admin-managed table so
-- new activities can be added from Settings.

CREATE TABLE "activity_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_types_name_key" ON "activity_types"("name");

-- Seed one row per existing enum value, preserving the original order.
INSERT INTO "activity_types" ("id", "name", "sortOrder") VALUES
    (gen_random_uuid()::text, 'Riser Cutting', 1),
    (gen_random_uuid()::text, 'Belt Sander',   2),
    (gen_random_uuid()::text, 'Manual Filing', 3),
    (gen_random_uuid()::text, 'Leak Testing',  4),
    (gen_random_uuid()::text, 'Welding',       5);

-- Map an old enum label to the new row name.
CREATE OR REPLACE FUNCTION pg_temp.activity_name(label text) RETURNS text AS $$
  SELECT CASE label
    WHEN 'RISER_CUTTING' THEN 'Riser Cutting'
    WHEN 'BELT_SANDER'   THEN 'Belt Sander'
    WHEN 'MANUAL_FILING' THEN 'Manual Filing'
    WHEN 'LEAK_TESTING'  THEN 'Leak Testing'
    WHEN 'WELDING'       THEN 'Welding'
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ---- employees -------------------------------------------------------
ALTER TABLE "employees" ADD COLUMN "activityTypeId" TEXT;

UPDATE "employees" e
SET "activityTypeId" = a."id"
FROM "activity_types" a
WHERE a."name" = pg_temp.activity_name(e."assignedTask"::text);

ALTER TABLE "employees" ALTER COLUMN "activityTypeId" SET NOT NULL;
DROP INDEX IF EXISTS "employees_assignedTask_idx";
ALTER TABLE "employees" DROP COLUMN "assignedTask";
CREATE INDEX "employees_activityTypeId_idx" ON "employees"("activityTypeId");
ALTER TABLE "employees" ADD CONSTRAINT "employees_activityTypeId_fkey"
    FOREIGN KEY ("activityTypeId") REFERENCES "activity_types"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- fettling activities ---------------------------------------------
ALTER TABLE "fettling_activities" ADD COLUMN "activityTypeId" TEXT;

UPDATE "fettling_activities" f
SET "activityTypeId" = a."id"
FROM "activity_types" a
WHERE a."name" = pg_temp.activity_name(f."operation"::text);

ALTER TABLE "fettling_activities" ALTER COLUMN "activityTypeId" SET NOT NULL;
DROP INDEX IF EXISTS "fettling_activities_operation_idx";
ALTER TABLE "fettling_activities" DROP COLUMN "operation";
CREATE INDEX "fettling_activities_activityTypeId_idx" ON "fettling_activities"("activityTypeId");
ALTER TABLE "fettling_activities" ADD CONSTRAINT "fettling_activities_activityTypeId_fkey"
    FOREIGN KEY ("activityTypeId") REFERENCES "activity_types"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TYPE "FettlingOperation";
