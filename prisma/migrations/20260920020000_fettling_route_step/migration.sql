-- Which station in the part's route a day's work belongs to.
--
-- Without this an entry is only a number to be summed, which is how ten
-- castings through two stations came to read as twenty parts. With it, an
-- entry says "these pieces moved from here to there".
--
-- Nullable and additive. Every existing row keeps NULL, meaning "recorded
-- before routing existed": those entries still count as labour but move no
-- pieces, so their figures cannot feed the double count back in.
ALTER TABLE "fettling_activity_items" ADD COLUMN "routeStepId" TEXT;

CREATE INDEX "fettling_activity_items_routeStepId_idx"
  ON "fettling_activity_items"("routeStepId");

-- A step that still has work recorded against it must not disappear from
-- under that history.
ALTER TABLE "fettling_activity_items" ADD CONSTRAINT "fettling_activity_items_routeStepId_fkey"
  FOREIGN KEY ("routeStepId") REFERENCES "part_route_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
