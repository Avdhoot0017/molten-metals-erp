-- Fettling records how many parts an employee handled; this adds how many of
-- those failed inspection. Existing rows default to 0 rejected, which is what
-- they meant when there was nowhere to record a reject.
ALTER TABLE "fettling_activities"
  ADD COLUMN "partsRejected" INTEGER NOT NULL DEFAULT 0;
