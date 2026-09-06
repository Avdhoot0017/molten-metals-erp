-- Plant-wide settings, edited in Settings > System.
--
-- Key-value rather than a column per setting: these are a few small strings,
-- and adding another should not need a migration. Defaults live in
-- lib/settings.ts, so a missing row is normal rather than an error.
CREATE TABLE "app_settings" (
  "key"       TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);
