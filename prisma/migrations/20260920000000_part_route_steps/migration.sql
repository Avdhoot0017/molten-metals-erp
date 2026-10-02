-- The ordered processes a part passes through: fettling, decoring, cutting...
--
-- Without this the system could not tell one batch of ten pieces moving
-- through three stations from thirty pieces existing, because every station's
-- entry was counted as new output.
--
-- A new table only. No existing table or column is read, written or altered.
CREATE TABLE "part_route_steps" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "activityTypeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_route_steps_pkey" PRIMARY KEY ("id")
);

-- Two steps cannot share a position in the route
CREATE UNIQUE INDEX "part_route_steps_partId_sequence_key"
  ON "part_route_steps"("partId", "sequence");

-- The same process cannot appear twice in one route - an entry for it would be
-- ambiguous about which step it belongs to
CREATE UNIQUE INDEX "part_route_steps_partId_activityTypeId_key"
  ON "part_route_steps"("partId", "activityTypeId");

CREATE INDEX "part_route_steps_partId_idx" ON "part_route_steps"("partId");

ALTER TABLE "part_route_steps" ADD CONSTRAINT "part_route_steps_partId_fkey"
  FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Processes are deactivated rather than deleted, so RESTRICT is right here:
-- a process in use by a route should not vanish from under it.
ALTER TABLE "part_route_steps" ADD CONSTRAINT "part_route_steps_activityTypeId_fkey"
  FOREIGN KEY ("activityTypeId") REFERENCES "activity_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
