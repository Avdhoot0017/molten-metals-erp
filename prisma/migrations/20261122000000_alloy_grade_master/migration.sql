-- Alloy grades become an admin-managed master, and a heat's charge becomes
-- rows instead of fixed columns.
--
-- WHY: three grades charged together come out as a fourth alloy. That fourth
-- has to exist as a material in its own right - held as scrap, charged into
-- the next heat, bought as ingot - and a hardcoded enum of twelve values
-- cannot hold it.
--
-- SAFETY: additive only.
--   * No table, column or constraint is dropped. The old enum TYPE is left
--     defined even though nothing uses it any more.
--   * The two enum columns become TEXT via USING ::text, which preserves
--     every stored string byte for byte - the enum labels already read
--     INGOT_LM6, SPILLAGE_LM9 and so on.
--   * Existing rows are READ to fill the new columns and tables. Nothing is
--     deleted and no existing value is rewritten.
--   * Every statement is guarded, so a partial or repeated run is safe.

-- ---------------------------------------------------------------- the master
CREATE TABLE IF NOT EXISTS "alloy_grades" (
    "id"              TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    "description"     TEXT,
    "colorHex"        TEXT,
    "sortOrder"       INTEGER NOT NULL DEFAULT 0,
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "canBePurchased"  BOOLEAN NOT NULL DEFAULT true,
    "compositionSpec" JSONB,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alloy_grades_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "alloy_grades_name_key" ON "alloy_grades"("name");
CREATE INDEX IF NOT EXISTS "alloy_grades_isActive_sortOrder_idx" ON "alloy_grades"("isActive", "sortOrder");

-- The three grades the foundry already runs, with the descriptions and colours
-- they are drawn with today, so nothing changes on screen.
INSERT INTO "alloy_grades" ("id", "name", "description", "colorHex", "sortOrder")
VALUES
  (gen_random_uuid()::text, 'LM6',  'AlSi12 - general casting alloy', '#B8860B', 1),
  (gen_random_uuid()::text, 'LM9',  'AlSi10Mg - higher strength',     '#10B981', 2),
  (gen_random_uuid()::text, 'LM25', 'AlSi7Mg - heat treatable',       '#8B5CF6', 3)
ON CONFLICT ("name") DO NOTHING;

-- Any grade already named by a part but missing from the list above is added
-- rather than ignored: a part pointing at a grade that does not exist would
-- fail validation the first time somebody edited it.
INSERT INTO "alloy_grades" ("id", "name", "sortOrder")
SELECT gen_random_uuid()::text, p."alloyGrade", 90
FROM (SELECT DISTINCT "alloyGrade" FROM "parts" WHERE "alloyGrade" IS NOT NULL AND "alloyGrade" <> '') p
ON CONFLICT ("name") DO NOTHING;

-- --------------------------------------------------- reads a composed name
-- "SPILLAGE_LM9" -> form SPILLAGE, grade LM9. Longest form first, so
-- RUNNER_RAISER is not read as RUNNER.
CREATE OR REPLACE FUNCTION pg_temp.material_form(label text) RETURNS text AS $$
  SELECT CASE
    WHEN label LIKE 'RUNNER_RAISER_%' THEN 'RUNNER_RAISER'
    WHEN label LIKE 'REJECTED_PART_%' THEN 'REJECTED_PART'
    WHEN label LIKE 'SPILLAGE_%'      THEN 'SPILLAGE'
    WHEN label LIKE 'INGOT_%'         THEN 'INGOT'
  END;
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION pg_temp.material_grade(label text) RETURNS text AS $$
  SELECT CASE
    WHEN label LIKE 'RUNNER_RAISER_%' THEN substring(label from 15)
    WHEN label LIKE 'REJECTED_PART_%' THEN substring(label from 15)
    WHEN label LIKE 'SPILLAGE_%'      THEN substring(label from 10)
    WHEN label LIKE 'INGOT_%'         THEN substring(label from 7)
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ------------------------------------------------------------- inventory
-- Enum -> text. The labels are already the strings we want, so every row
-- keeps the value it had.
ALTER TABLE "inventory"      ALTER COLUMN "type" TYPE TEXT USING "type"::text;
ALTER TABLE "inventory_logs" ALTER COLUMN "type" TYPE TEXT USING "type"::text;

ALTER TABLE "inventory"      ADD COLUMN IF NOT EXISTS "gradeId" TEXT;
ALTER TABLE "inventory"      ADD COLUMN IF NOT EXISTS "form"    TEXT;
ALTER TABLE "inventory_logs" ADD COLUMN IF NOT EXISTS "gradeId" TEXT;
ALTER TABLE "inventory_logs" ADD COLUMN IF NOT EXISTS "form"    TEXT;

-- Fill the new columns from the name each line already carries. A line whose
-- name does not parse keeps NULL rather than being guessed at.
UPDATE "inventory" i
SET "gradeId" = g."id", "form" = pg_temp.material_form(i."type")
FROM "alloy_grades" g
WHERE g."name" = pg_temp.material_grade(i."type")
  AND i."gradeId" IS NULL;

UPDATE "inventory_logs" l
SET "gradeId" = g."id", "form" = pg_temp.material_form(l."type")
FROM "alloy_grades" g
WHERE g."name" = pg_temp.material_grade(l."type")
  AND l."gradeId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_gradeId_form_key" ON "inventory"("gradeId", "form");
CREATE INDEX IF NOT EXISTS "inventory_gradeId_idx" ON "inventory"("gradeId");
CREATE INDEX IF NOT EXISTS "inventory_logs_gradeId_form_idx" ON "inventory_logs"("gradeId", "form");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_gradeId_fkey') THEN
    ALTER TABLE "inventory" ADD CONSTRAINT "inventory_gradeId_fkey"
      FOREIGN KEY ("gradeId") REFERENCES "alloy_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_logs_gradeId_fkey') THEN
    ALTER TABLE "inventory_logs" ADD CONSTRAINT "inventory_logs_gradeId_fkey"
      FOREIGN KEY ("gradeId") REFERENCES "alloy_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ------------------------------------------------------ production records
ALTER TABLE "production_records" ALTER COLUMN "ingotGrade" TYPE TEXT USING "ingotGrade"::text;
ALTER TABLE "production_records" ALTER COLUMN "ingotGrade" SET DEFAULT 'INGOT_LM6';
ALTER TABLE "production_records" ADD COLUMN IF NOT EXISTS "resultGradeId" TEXT;

-- The alloy each existing heat came out as is the alloy it was run on.
UPDATE "production_records" r
SET "resultGradeId" = g."id"
FROM "alloy_grades" g
WHERE g."name" = pg_temp.material_grade(r."ingotGrade")
  AND r."resultGradeId" IS NULL;

CREATE INDEX IF NOT EXISTS "production_records_resultGradeId_idx" ON "production_records"("resultGradeId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_records_resultGradeId_fkey') THEN
    ALTER TABLE "production_records" ADD CONSTRAINT "production_records_resultGradeId_fkey"
      FOREIGN KEY ("resultGradeId") REFERENCES "alloy_grades"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ------------------------------------------------------------ charge lines
CREATE TABLE IF NOT EXISTS "production_charges" (
    "id"                 TEXT NOT NULL,
    "productionRecordId" TEXT NOT NULL,
    "gradeId"            TEXT NOT NULL,
    "form"               TEXT NOT NULL,
    "weight"             DOUBLE PRECISION NOT NULL,
    "fromHeel"           BOOLEAN NOT NULL DEFAULT false,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_charges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "production_charges_record_grade_form_heel_key"
  ON "production_charges"("productionRecordId", "gradeId", "form", "fromHeel");
CREATE INDEX IF NOT EXISTS "production_charges_productionRecordId_idx" ON "production_charges"("productionRecordId");
CREATE INDEX IF NOT EXISTS "production_charges_gradeId_idx" ON "production_charges"("gradeId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_charges_productionRecordId_fkey') THEN
    ALTER TABLE "production_charges" ADD CONSTRAINT "production_charges_productionRecordId_fkey"
      FOREIGN KEY ("productionRecordId") REFERENCES "production_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_charges_gradeId_fkey') THEN
    ALTER TABLE "production_charges" ADD CONSTRAINT "production_charges_gradeId_fkey"
      FOREIGN KEY ("gradeId") REFERENCES "alloy_grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- One line per non-zero weight on every existing batch. Ingot goes in at the
-- grade it was recorded under; scrap at the batch's own grade, which is the
-- only grade of scrap an old batch was allowed to re-melt.
INSERT INTO "production_charges" ("id", "productionRecordId", "gradeId", "form", "weight", "fromHeel", "createdAt")
SELECT gen_random_uuid()::text, src."id", src."gradeId", src."form", src."weight", src."fromHeel", src."createdAt"
FROM (
  SELECT r."id", g."id" AS "gradeId", 'INGOT' AS "form", r."aluminumUsedLM6" AS "weight", false AS "fromHeel", r."createdAt"
    FROM "production_records" r JOIN "alloy_grades" g ON g."name" = 'LM6'  WHERE r."aluminumUsedLM6"  > 0
  UNION ALL
  SELECT r."id", g."id", 'INGOT', r."aluminumUsedLM9", false, r."createdAt"
    FROM "production_records" r JOIN "alloy_grades" g ON g."name" = 'LM9'  WHERE r."aluminumUsedLM9"  > 0
  UNION ALL
  SELECT r."id", g."id", 'INGOT', r."aluminumUsedLM25", false, r."createdAt"
    FROM "production_records" r JOIN "alloy_grades" g ON g."name" = 'LM25' WHERE r."aluminumUsedLM25" > 0
  UNION ALL
  SELECT r."id", r."resultGradeId", 'RUNNER_RAISER', r."runnerRaiserScrapUsed", false, r."createdAt"
    FROM "production_records" r WHERE r."runnerRaiserScrapUsed" > 0 AND r."resultGradeId" IS NOT NULL
  UNION ALL
  SELECT r."id", r."resultGradeId", 'SPILLAGE', r."spillageScrapUsed", false, r."createdAt"
    FROM "production_records" r WHERE r."spillageScrapUsed" > 0 AND r."resultGradeId" IS NOT NULL
  UNION ALL
  SELECT r."id", r."resultGradeId", 'REJECTED_PART', r."rejectedPartScrapUsed", false, r."createdAt"
    FROM "production_records" r WHERE r."rejectedPartScrapUsed" > 0 AND r."resultGradeId" IS NOT NULL
  UNION ALL
  -- Metal carried in from the previous heat, marked so it moves no stock
  SELECT r."id", r."resultGradeId", 'INGOT', r."carriedInWeight", true, r."createdAt"
    FROM "production_records" r WHERE r."carriedInWeight" > 0 AND r."resultGradeId" IS NOT NULL
) src
ON CONFLICT ("productionRecordId", "gradeId", "form", "fromHeel") DO NOTHING;
