-- PLANT_HEAD is renamed to PRODUCTION_MANAGER. Renaming the enum value keeps
-- every existing user row pointing at the same role, with no data rewrite.
ALTER TYPE "UserRole" RENAME VALUE 'PLANT_HEAD' TO 'PRODUCTION_MANAGER';

-- New read-only role that also manages users and settings.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ACCOUNTS';
