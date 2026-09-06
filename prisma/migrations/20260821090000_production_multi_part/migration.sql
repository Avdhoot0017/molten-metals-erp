-- A production batch can now cast several parts, so per-part quantities move
-- out of production_records into production_items line rows.

CREATE TABLE "production_items" (
    "id" TEXT NOT NULL,
    "productionRecordId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantityProduced" INTEGER NOT NULL,
    "goodParts" INTEGER NOT NULL,
    "rejectedParts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "production_items_productionRecordId_idx" ON "production_items"("productionRecordId");
CREATE INDEX "production_items_partId_idx" ON "production_items"("partId");

ALTER TABLE "production_items" ADD CONSTRAINT "production_items_productionRecordId_fkey"
    FOREIGN KEY ("productionRecordId") REFERENCES "production_records"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "production_items" ADD CONSTRAINT "production_items_partId_fkey"
    FOREIGN KEY ("partId") REFERENCES "parts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing record becomes a single-part batch, preserving its
-- part and quantities. Must run before the column is dropped.
INSERT INTO "production_items" (
    "id", "productionRecordId", "partId",
    "quantityProduced", "goodParts", "rejectedParts", "createdAt"
)
SELECT
    gen_random_uuid()::text,
    r."id",
    r."partId",
    r."quantityProduced",
    r."goodParts",
    r."rejectedParts",
    r."createdAt"
FROM "production_records" r;

ALTER TABLE "production_records" DROP CONSTRAINT IF EXISTS "production_records_partId_fkey";
ALTER TABLE "production_records" DROP COLUMN "partId";
