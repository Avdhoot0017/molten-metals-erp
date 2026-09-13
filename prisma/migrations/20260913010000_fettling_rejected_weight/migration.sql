-- The scrap a rejected casting puts into stock was always count x the part's
-- weight. That is right most of the time but not always - a reject can be a
-- part-filled pour, or already broken up - so the bench weight can now be
-- entered instead.
--
-- Additive and nullable: every existing line stays NULL, which means "no weight
-- was given, use the calculation", so nothing that is already recorded changes
-- value or has to be backfilled.
ALTER TABLE "fettling_activity_items" ADD COLUMN "rejectedWeight" DOUBLE PRECISION;
