-- CreateEnum
CREATE TYPE "FettlingOperation" AS ENUM ('RISER_CUTTING', 'BELT_SANDER', 'MANUAL_FILING', 'LEAK_TESTING', 'WELDING');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'FETTLING_MANAGER';

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "employeeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "assignedTask" "FettlingOperation" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fettling_activities" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "operation" "FettlingOperation" NOT NULL,
    "date" DATE NOT NULL,
    "partId" TEXT,
    "partsCompleted" INTEGER NOT NULL,
    "notes" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fettling_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_employeeCode_key" ON "employees"("employeeCode");

-- CreateIndex
CREATE INDEX "employees_assignedTask_idx" ON "employees"("assignedTask");

-- CreateIndex
CREATE INDEX "fettling_activities_date_idx" ON "fettling_activities"("date");

-- CreateIndex
CREATE INDEX "fettling_activities_employeeId_date_idx" ON "fettling_activities"("employeeId", "date");

-- CreateIndex
CREATE INDEX "fettling_activities_operation_idx" ON "fettling_activities"("operation");

-- AddForeignKey
ALTER TABLE "fettling_activities" ADD CONSTRAINT "fettling_activities_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fettling_activities" ADD CONSTRAINT "fettling_activities_partId_fkey" FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fettling_activities" ADD CONSTRAINT "fettling_activities_recordedBy_fkey" FOREIGN KEY ("recordedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
