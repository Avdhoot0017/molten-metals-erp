-- Free-form per-batch composition entries: [{ "key": "Si", "value": "11.2" }, ...]
ALTER TABLE "production_records" ADD COLUMN "composition" JSONB;
