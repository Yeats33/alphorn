-- Ordered output-channel failover.
-- Existing webhook/channel links remain at level 1, preserving the current
-- fan-out behavior. Later levels remain WAITING until every eligible delivery
-- in the active level reaches a terminal failure state.

ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'WAITING' BEFORE 'PENDING';
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'RETRYING' AFTER 'PROCESSING';
ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'SKIPPED' AFTER 'STALE';

ALTER TABLE "WebhookChannel"
  ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "WebhookChannel_level_check" CHECK ("level" BETWEEN 1 AND 99);

ALTER TABLE "Delivery"
  ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "Delivery_level_check" CHECK ("level" BETWEEN 1 AND 99);

CREATE INDEX "Delivery_messageId_level_status_idx"
  ON "Delivery"("messageId", "level", "status");
