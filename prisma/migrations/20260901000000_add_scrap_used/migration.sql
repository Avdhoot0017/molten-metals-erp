-- Scrap charged back into the melt, recorded per batch alongside the scrap
-- generated. Defaults keep every existing batch valid: they recorded no
-- re-melted scrap, which is exactly 0.
ALTER TABLE "production_records"
  ADD COLUMN "runnerRaiserScrapUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "spillageScrapUsed"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "rejectedPartScrapUsed" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "totalScrapUsed"        DOUBLE PRECISION NOT NULL DEFAULT 0;
