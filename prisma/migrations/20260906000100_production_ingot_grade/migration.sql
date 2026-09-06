-- The alloy a batch was run on. Separate migration from the enum change above
-- because Postgres will not let a value added by ALTER TYPE ... ADD VALUE be
-- used in the same transaction that added it.
ALTER TABLE "production_records"
  ADD COLUMN "ingotGrade" "AluminumType" NOT NULL DEFAULT 'INGOT_LM6';

-- Backfill from the per-grade weights: whichever grade the heat was charged
-- with is the grade of the batch. Mixed batches take the largest share, and
-- batches with no ingot recorded keep the LM6 default.
UPDATE "production_records"
SET "ingotGrade" = CASE
  WHEN "aluminumUsedLM25" > "aluminumUsedLM6" AND "aluminumUsedLM25" >= "aluminumUsedLM9"
    THEN 'INGOT_LM25'::"AluminumType"
  WHEN "aluminumUsedLM9" > "aluminumUsedLM6" AND "aluminumUsedLM9" > "aluminumUsedLM25"
    THEN 'INGOT_LM9'::"AluminumType"
  ELSE 'INGOT_LM6'::"AluminumType"
END;
