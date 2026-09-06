-- Reduced Pressure Test figures per batch.
-- Nullable: batches recorded before DI tracking stay valid.
ALTER TABLE "production_records" ADD COLUMN "densityAtmospheric" DOUBLE PRECISION;
ALTER TABLE "production_records" ADD COLUMN "densityVacuum" DOUBLE PRECISION;
ALTER TABLE "production_records" ADD COLUMN "densityIndex" DOUBLE PRECISION;
