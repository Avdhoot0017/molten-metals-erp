-- Where every piece is, and every move it has made.
--
-- The bug this fixes: ten castings fettled and then decored were counted as
-- twenty parts, because each station's entry was summed as fresh output. With
-- these tables a station's entry MOVES pieces from one stage to the next, so
-- ten pieces stay ten however many stations they pass through.
--
-- New tables and a new enum only. Nothing existing is read, written or altered;
-- the fettling and production tables keep every row exactly as it is.
CREATE TYPE "StageKind" AS ENUM ('WAITING', 'REWORK', 'READY');

CREATE TABLE "part_stages" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "kind" "StageKind" NOT NULL,
    "routeStepId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_stages_pkey" PRIMARY KEY ("id")
);

-- One balance per place per part. The key is a string because READY has no
-- step, and a NULL step in this index would let two READY rows exist.
CREATE UNIQUE INDEX "part_stages_partId_stageKey_key" ON "part_stages"("partId", "stageKey");
CREATE INDEX "part_stages_partId_idx" ON "part_stages"("partId");
CREATE INDEX "part_stages_routeStepId_idx" ON "part_stages"("routeStepId");

CREATE TABLE "part_stage_logs" (
    "id" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "previousQty" INTEGER NOT NULL,
    "newQty" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "referenceId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "part_stage_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "part_stage_logs_partId_idx" ON "part_stage_logs"("partId");
CREATE INDEX "part_stage_logs_createdAt_idx" ON "part_stage_logs"("createdAt");

ALTER TABLE "part_stages" ADD CONSTRAINT "part_stages_partId_fkey"
  FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Removing a step from a route takes its queue with it. The route editor
-- should refuse to drop a step that still holds pieces; this is the backstop.
ALTER TABLE "part_stages" ADD CONSTRAINT "part_stages_routeStepId_fkey"
  FOREIGN KEY ("routeStepId") REFERENCES "part_route_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "part_stage_logs" ADD CONSTRAINT "part_stage_logs_partId_fkey"
  FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
