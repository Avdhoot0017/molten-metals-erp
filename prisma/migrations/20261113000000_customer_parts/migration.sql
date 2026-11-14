-- Which of our parts each customer buys.
--
-- One new table and nothing else. No existing table, column or row is read,
-- rewritten or removed, so this cannot lose data and is safe to replay: every
-- statement is guarded with IF NOT EXISTS or an existence check.
--
-- The table starts empty, which is the honest state - no customer has had
-- their list recorded yet. Screens treat an empty list as "not recorded yet"
-- rather than "buys nothing", so existing customers and their orders carry on
-- working untouched.

CREATE TABLE IF NOT EXISTS "customer_parts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_parts_pkey" PRIMARY KEY ("id")
);

-- One row per customer/part pair: adding the same part twice is the same fact
CREATE UNIQUE INDEX IF NOT EXISTS "customer_parts_companyId_partId_key"
  ON "customer_parts"("companyId", "partId");
CREATE INDEX IF NOT EXISTS "customer_parts_companyId_idx" ON "customer_parts"("companyId");
CREATE INDEX IF NOT EXISTS "customer_parts_partId_idx" ON "customer_parts"("partId");

-- Cascade is safe here only because a row carries no history of its own - it
-- is a list of what a customer buys. Orders, dispatches and piece movements
-- keep their own part references and are untouched by anything here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_parts_companyId_fkey'
  ) THEN
    ALTER TABLE "customer_parts"
      ADD CONSTRAINT "customer_parts_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "companies"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_parts_partId_fkey'
  ) THEN
    ALTER TABLE "customer_parts"
      ADD CONSTRAINT "customer_parts_partId_fkey"
      FOREIGN KEY ("partId") REFERENCES "parts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
