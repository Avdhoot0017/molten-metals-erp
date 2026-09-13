-- A casting is poured with its gating system attached - runners, risers,
-- feeders - and that metal is cut off afterwards. The finished weight alone
-- never explained where a foundry's runner scrap came from, so the poured
-- weight is recorded too, and the difference between them is the expected
-- scrap.
--
-- Additive only. The one existing column, "expectedScrap", holds the old
-- hand-typed percentages and is NOT touched: no rewrite, no rename, no drop.
-- It stops being read, which costs nothing and leaves every previous figure
-- recoverable. The new column is nullable so no row has to be given a value
-- it does not have.
ALTER TABLE "parts" ADD COLUMN "pouringWeight" DOUBLE PRECISION;

-- Backfill from the old percentage where one was actually set, so existing
-- parts arrive with a sensible pouring weight instead of a blank field. Writes
-- only the new column. A part left at 0% stays NULL - "nobody has measured the
-- gating", which is true, rather than a fabricated figure.
UPDATE "parts"
SET "pouringWeight" = "weightPerPiece" + ("weightPerPiece" * "expectedScrap" / 100.0)
WHERE "expectedScrap" > 0;
