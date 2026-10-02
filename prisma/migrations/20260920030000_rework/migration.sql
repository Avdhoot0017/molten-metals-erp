-- Rejected does not have to mean melted.
--
-- A casting that fails a leak test can often be saved by a weld. Until now
-- every reject went straight to the melt, so a foundry recovering pieces at
-- the welding bench had no way to say so - and the metal was booked as scrap
-- that never actually went back in the furnace.
--
-- Three nullable/defaulted columns. Existing rows keep reworkQty = 0, which is
-- exactly what they meant: every reject on them did go to the melt.
ALTER TABLE "fettling_activity_items" ADD COLUMN "reworkQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "fettling_activity_items" ADD COLUMN "reworkFromStepId" TEXT;
ALTER TABLE "fettling_activity_items" ADD COLUMN "returnStepId" TEXT;

CREATE INDEX "fettling_activity_items_reworkFromStepId_idx"
  ON "fettling_activity_items"("reworkFromStepId");

ALTER TABLE "fettling_activity_items" ADD CONSTRAINT "fettling_activity_items_reworkFromStepId_fkey"
  FOREIGN KEY ("reworkFromStepId") REFERENCES "part_route_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "fettling_activity_items" ADD CONSTRAINT "fettling_activity_items_returnStepId_fkey"
  FOREIGN KEY ("returnStepId") REFERENCES "part_route_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
