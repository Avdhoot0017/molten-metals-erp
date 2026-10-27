-- Outward: finished castings going out to a customer.
--
-- The dispatch tables already existed but nothing wrote to them. This adds
-- what an outward note needs to be useful - which order it is against and who
-- recorded it - plus the indexes the customer-wise reports read on.
--
-- Purely additive and nullable throughout. No existing row is read, written
-- or deleted.

-- Which customer order this delivery is against. Nullable: castings also go
-- out against a verbal call-off or as samples, with no PO behind them.
ALTER TABLE "dispatches" ADD COLUMN IF NOT EXISTS "customerOrderId" TEXT;

-- Who recorded it. Nullable - nothing recorded before this was asked for has
-- an answer, and inventing one would be worse than a blank.
ALTER TABLE "dispatches" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;

CREATE INDEX IF NOT EXISTS "dispatches_companyId_idx" ON "dispatches"("companyId");
CREATE INDEX IF NOT EXISTS "dispatches_dispatchDate_idx" ON "dispatches"("dispatchDate");
CREATE INDEX IF NOT EXISTS "dispatches_customerOrderId_idx" ON "dispatches"("customerOrderId");
CREATE INDEX IF NOT EXISTS "dispatch_items_dispatchId_idx" ON "dispatch_items"("dispatchId");
CREATE INDEX IF NOT EXISTS "dispatch_items_partId_idx" ON "dispatch_items"("partId");

-- An order that is deleted leaves its deliveries standing: the castings still
-- left the yard, and losing that record would put stock back on the books
-- that is not there.
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_customerOrderId_fkey"
  FOREIGN KEY ("customerOrderId") REFERENCES "customer_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_createdBy_fkey"
  FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
