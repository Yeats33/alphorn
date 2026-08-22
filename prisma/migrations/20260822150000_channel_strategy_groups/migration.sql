-- Reusable channel strategy groups. Group members own their routing filters,
-- failover levels, and Always behavior; webhooks attach the group once.
CREATE TABLE "ChannelGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "organizationId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChannelGroupMember" (
  "groupId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "filter" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "level" INTEGER NOT NULL DEFAULT 1,
  "alwaysDeliver" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ChannelGroupMember_pkey" PRIMARY KEY ("groupId", "channelId"),
  CONSTRAINT "ChannelGroupMember_level_check" CHECK ("level" BETWEEN 1 AND 99)
);

CREATE TABLE "WebhookChannelGroup" (
  "webhookId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "WebhookChannelGroup_pkey" PRIMARY KEY ("webhookId", "groupId")
);

CREATE INDEX "ChannelGroup_organizationId_idx" ON "ChannelGroup"("organizationId");
CREATE UNIQUE INDEX "ChannelGroupMember_channelId_key" ON "ChannelGroupMember"("channelId");
CREATE INDEX "ChannelGroupMember_groupId_idx" ON "ChannelGroupMember"("groupId");
CREATE INDEX "WebhookChannelGroup_groupId_idx" ON "WebhookChannelGroup"("groupId");

ALTER TABLE "ChannelGroup"
  ADD CONSTRAINT "ChannelGroup_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelGroupMember"
  ADD CONSTRAINT "ChannelGroupMember_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ChannelGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelGroupMember"
  ADD CONSTRAINT "ChannelGroupMember_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "Channel"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookChannelGroup"
  ADD CONSTRAINT "WebhookChannelGroup_webhookId_fkey"
  FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookChannelGroup"
  ADD CONSTRAINT "WebhookChannelGroup_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "ChannelGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER alphorn_channel_group_invalidate
AFTER INSERT OR UPDATE OR DELETE ON "ChannelGroup"
FOR EACH ROW EXECUTE FUNCTION alphorn_notify_cache_invalidate();
CREATE TRIGGER alphorn_channel_group_member_invalidate
AFTER INSERT OR UPDATE OR DELETE ON "ChannelGroupMember"
FOR EACH ROW EXECUTE FUNCTION alphorn_notify_cache_invalidate();
CREATE TRIGGER alphorn_webhook_channel_group_invalidate
AFTER INSERT OR UPDATE OR DELETE ON "WebhookChannelGroup"
FOR EACH ROW EXECUTE FUNCTION alphorn_notify_cache_invalidate();
