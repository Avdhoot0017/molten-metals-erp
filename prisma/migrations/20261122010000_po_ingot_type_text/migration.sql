-- A purchase order may be raised for any alloy the admin has configured.
--
-- Same change as inventory, same reasoning: the grade list is a table now, so
-- the column holding "INGOT_<grade>" cannot be an enum of three. USING ::text
-- keeps every stored value byte for byte, and the default is restated so new
-- rows behave exactly as before. Nothing is dropped and no row is rewritten.

ALTER TABLE "purchase_orders" ALTER COLUMN "ingotType" TYPE TEXT USING "ingotType"::text;
ALTER TABLE "purchase_orders" ALTER COLUMN "ingotType" SET DEFAULT 'INGOT_LM6';
