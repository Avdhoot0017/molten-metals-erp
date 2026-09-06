-- A purchase order is raised for one grade, and delivery adds to that grade.
-- Existing orders were all for the ungraded stock that is now LM6.
ALTER TABLE "purchase_orders"
  ADD COLUMN "ingotType" "AluminumType" NOT NULL DEFAULT 'INGOT_LM6';

-- A batch may be charged with more than one grade, so the split is recorded
-- alongside the existing total. `aluminumUsed` stays the total of the three,
-- so efficiency and every existing aggregate keep working untouched.
ALTER TABLE "production_records"
  ADD COLUMN "aluminumUsedLM6"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "aluminumUsedLM9"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "aluminumUsedLM25" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Every batch recorded so far drew on the stock that is now LM6.
UPDATE "production_records" SET "aluminumUsedLM6" = "aluminumUsed";
