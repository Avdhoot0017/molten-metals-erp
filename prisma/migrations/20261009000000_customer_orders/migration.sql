-- Customers and the purchase orders they send us.
--
-- Purely additive: two nullable columns on a table that already exists, one
-- new enum and two new tables. No existing row is read, written or deleted,
-- so this is safe to run against production with data in it.

-- The customer's tax identity, as printed on their purchase orders. Nullable
-- because every customer already on file was recorded without it, and a blank
-- says "not on file" where an empty string would claim it was asked for.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "gstNumber" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "stateCode" TEXT;

-- How much of an order has been supplied. Hand-set for now - nothing in
-- production moves it yet.
DO $$
BEGIN
  CREATE TYPE "CustomerOrderStatus" AS ENUM ('OPEN', 'PARTIAL', 'COMPLETED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- An order received FROM a customer. The opposite direction to
-- "purchase_orders", which is us buying ingot from a supplier.
CREATE TABLE IF NOT EXISTS "customer_orders" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "poDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referenceNo" TEXT,
    "referenceDate" TIMESTAMP(3),
    "deliveryAddress" TEXT,
    "transporterName" TEXT,
    "transport" TEXT,
    "paymentTerms" TEXT,
    "status" "CustomerOrderStatus" NOT NULL DEFAULT 'OPEN',
    "subTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cgstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "specialInstructions" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_orders_pkey" PRIMARY KEY ("id")
);

-- One line of their PO: their item code, their HSN, their rate and tax.
-- partId is nullable - an order often arrives before the part is set up here,
-- and refusing to record it until then would mean it never gets recorded.
CREATE TABLE IF NOT EXISTS "customer_order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "partId" TEXT,
    "itemCode" TEXT NOT NULL,
    "description" TEXT,
    "hsnCode" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'NOS',
    "rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cgstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cgstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sgstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "igstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scheduleDate" TIMESTAMP(3),
    "scheduleQty" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_order_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "customer_orders_companyId_idx" ON "customer_orders"("companyId");
CREATE INDEX IF NOT EXISTS "customer_orders_poDate_idx" ON "customer_orders"("poDate");

-- A PO number belongs to the customer who issued it: two customers can each
-- have their own "001", so the number alone is not unique.
CREATE UNIQUE INDEX IF NOT EXISTS "customer_orders_companyId_poNumber_key"
  ON "customer_orders"("companyId", "poNumber");

CREATE INDEX IF NOT EXISTS "customer_order_items_orderId_idx" ON "customer_order_items"("orderId");
CREATE INDEX IF NOT EXISTS "customer_order_items_partId_idx" ON "customer_order_items"("partId");

ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_orders" ADD CONSTRAINT "customer_orders_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lines go with their order; a part is only ever referenced, never owned.
ALTER TABLE "customer_order_items" ADD CONSTRAINT "customer_order_items_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "customer_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_order_items" ADD CONSTRAINT "customer_order_items_partId_fkey"
  FOREIGN KEY ("partId") REFERENCES "parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
