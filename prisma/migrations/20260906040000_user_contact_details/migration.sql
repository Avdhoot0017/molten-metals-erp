-- The profile form has always offered phone and designation, but there was
-- nowhere to put them, so they silently did nothing on save.
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
ALTER TABLE "users" ADD COLUMN "designation" TEXT;
