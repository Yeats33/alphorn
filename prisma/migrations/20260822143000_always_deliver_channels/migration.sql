-- Independent archival/audit deliveries that always run alongside the
-- ordered failover chain and never satisfy or advance that chain.
ALTER TABLE "WebhookChannel"
  ADD COLUMN "alwaysDeliver" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Delivery"
  ADD COLUMN "alwaysDeliver" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS "Delivery_messageId_level_status_idx";
CREATE INDEX "Delivery_messageId_alwaysDeliver_level_status_idx"
  ON "Delivery"("messageId", "alwaysDeliver", "level", "status");
