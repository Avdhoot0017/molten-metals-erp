-- Melting furnaces (bhattis), managed by an admin in Settings.

CREATE TABLE "furnaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "furnaces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "furnaces_name_key" ON "furnaces"("name");

-- Nullable: batches recorded before furnace tracking keep working.
ALTER TABLE "production_records" ADD COLUMN "furnaceId" TEXT;

ALTER TABLE "production_records" ADD CONSTRAINT "production_records_furnaceId_fkey"
    FOREIGN KEY ("furnaceId") REFERENCES "furnaces"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
