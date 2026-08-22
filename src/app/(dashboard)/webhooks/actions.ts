"use server";

import { prisma } from "@/lib/db";
import { requireSession, requireOrgSession, requireAdminOrOwner } from "@/lib/auth/server";
import { getOrgLimits } from "@/lib/billing/subscription";
import { generateApiKey, generatePublicId, generateWebhookId } from "@/lib/api-key";
import { revalidatePath } from "next/cache";
import { FilterDefinition as FilterDefinitionSchema } from "@/lib/filter/schema";
import type { FilterDefinition } from "@/lib/filter/schema";
import { z } from "zod";

const templateStringSchema = z
  .string()
  .max(500, "Template must be 500 characters or fewer")
  .nullable()
  .optional();

const webhookTemplatesSchema = z.object({
  titleTemplate: templateStringSchema,
  messageTemplate: templateStringSchema,
  tagsTemplate: templateStringSchema,
  priorityTemplate: templateStringSchema,
});

const channelLevelSchema = z.number().int().min(1).max(99);
const channelAlwaysDeliverSchema = z.boolean();

function channelLevel(
  channelId: string,
  channelLevels?: Record<string, number>,
): number {
  return channelLevelSchema.parse(channelLevels?.[channelId] ?? 1);
}

function validateChannelLevels(
  channelIds: string[],
  channelLevels?: Record<string, number>,
): void {
  for (const channelId of channelIds) {
    channelLevel(channelId, channelLevels);
  }
}

function channelAlwaysDeliver(
  channelId: string,
  channelAlwaysDeliveries?: Record<string, boolean>,
): boolean {
  return channelAlwaysDeliverSchema.parse(
    channelAlwaysDeliveries?.[channelId] ?? false,
  );
}

function validateFilters(channelFilters?: Record<string, FilterDefinition | null>) {
  if (!channelFilters) return;
  for (const filter of Object.values(channelFilters)) {
    if (filter !== null) {
      FilterDefinitionSchema.parse(filter);
    }
  }
}

async function assertChannelsBelongToOrg(channelIds: string[], orgId: string) {
  if (channelIds.length === 0) return;
  const unique = Array.from(new Set(channelIds));
  const count = await prisma.channel.count({
    where: { id: { in: unique }, organizationId: orgId },
  });
  if (count !== unique.length) {
    throw new Error("One or more channels do not belong to this project");
  }
}

async function assertGroupsBelongToOrg(groupIds: string[], orgId: string) {
  if (groupIds.length === 0) return;
  const unique = Array.from(new Set(groupIds));
  const count = await prisma.channelGroup.count({
    where: { id: { in: unique }, organizationId: orgId },
  });
  if (count !== unique.length) {
    throw new Error("One or more strategy groups do not belong to this project");
  }
}

async function assertNoDirectGroupOverlap(
  channelIds: string[],
  groupIds: string[],
) {
  if (channelIds.length === 0 || groupIds.length === 0) return;
  const overlap = await prisma.channelGroupMember.findFirst({
    where: { groupId: { in: groupIds }, channelId: { in: channelIds } },
    select: { channelId: true },
  });
  if (overlap) {
    throw new Error(
      "A channel cannot be attached directly and through a selected strategy group",
    );
  }
}

export async function getWebhooksForOrg() {
  const session = await requireSession();
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return [];

  return prisma.webhook.findMany({
    where: { organizationId: orgId, deletedAt: null },
    include: {
      channels: {
        include: { channel: true },
      },
      channelGroups: {
        include: { group: true },
      },
      _count: { select: { messages: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getWebhookById(id: string) {
  const { orgId } = await requireOrgSession();

  return prisma.webhook.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
    include: {
      channels: {
        include: { channel: true },
      },
      channelGroups: {
        include: { group: true },
      },
    },
  });
}

export async function createWebhook(data: {
  name: string;
  description?: string;
  requireAuth?: boolean;
  channelIds: string[];
  channelGroupIds?: string[];
  channelFilters?: Record<string, FilterDefinition | null>;
  channelLevels?: Record<string, number>;
  channelAlwaysDeliveries?: Record<string, boolean>;
  titleTemplate?: string | null;
  messageTemplate?: string | null;
  tagsTemplate?: string | null;
  priorityTemplate?: string | null;
}) {
  const { orgId } = await requireAdminOrOwner();

  const limits = await getOrgLimits(orgId);
  if (limits?.webhooks !== null && limits?.webhooks !== undefined) {
    const currentCount = await prisma.webhook.count({
      where: { organizationId: orgId, deletedAt: null },
    });
    if (currentCount >= limits.webhooks) {
      throw new Error(
        `Webhook limit reached (${limits.webhooks}). Upgrade your plan for more.`,
      );
    }
  }

  validateFilters(data.channelFilters);
  validateChannelLevels(data.channelIds, data.channelLevels);
  await assertChannelsBelongToOrg(data.channelIds, orgId);
  const channelGroupIds = data.channelGroupIds ?? [];
  await assertGroupsBelongToOrg(channelGroupIds, orgId);
  await assertNoDirectGroupOverlap(data.channelIds, channelGroupIds);

  const templates = webhookTemplatesSchema.parse({
    titleTemplate: data.titleTemplate ?? null,
    messageTemplate: data.messageTemplate ?? null,
    tagsTemplate: data.tagsTemplate ?? null,
    priorityTemplate: data.priorityTemplate ?? null,
  });

  const webhook = await prisma.webhook.create({
    data: {
      id: generateWebhookId(),
      name: data.name,
      description: data.description || null,
      apiKey: generateApiKey(),
      publicId: generatePublicId(),
      requireAuth: data.requireAuth ?? true,
      organizationId: orgId,
      titleTemplate: templates.titleTemplate ?? null,
      messageTemplate: templates.messageTemplate ?? null,
      tagsTemplate: templates.tagsTemplate ?? null,
      priorityTemplate: templates.priorityTemplate ?? null,
      channels: {
        create: data.channelIds.map((channelId) => ({
          channelId,
          filter: data.channelFilters?.[channelId] ?? undefined,
          level: channelLevel(channelId, data.channelLevels),
          alwaysDeliver: channelAlwaysDeliver(
            channelId,
            data.channelAlwaysDeliveries,
          ),
        })),
      },
      channelGroups: {
        create: channelGroupIds.map((groupId) => ({ groupId })),
      },
    },
  });

  revalidatePath("/webhooks");
  return webhook;
}

export async function updateWebhook(
  id: string,
  data: {
    name: string;
    description?: string;
    enabled: boolean;
    requireAuth: boolean;
    channelIds: string[];
    channelGroupIds?: string[];
    channelFilters?: Record<string, FilterDefinition | null>;
    channelLevels?: Record<string, number>;
    channelAlwaysDeliveries?: Record<string, boolean>;
    titleTemplate?: string | null;
    messageTemplate?: string | null;
    tagsTemplate?: string | null;
    priorityTemplate?: string | null;
  }
) {
  const { orgId } = await requireAdminOrOwner();

  const existing = await prisma.webhook.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
  });
  if (!existing) throw new Error("Webhook not found");

  validateFilters(data.channelFilters);
  validateChannelLevels(data.channelIds, data.channelLevels);
  await assertChannelsBelongToOrg(data.channelIds, orgId);
  const channelGroupIds = data.channelGroupIds ?? [];
  await assertGroupsBelongToOrg(channelGroupIds, orgId);
  await assertNoDirectGroupOverlap(data.channelIds, channelGroupIds);

  const templates = webhookTemplatesSchema.parse({
    titleTemplate: data.titleTemplate ?? null,
    messageTemplate: data.messageTemplate ?? null,
    tagsTemplate: data.tagsTemplate ?? null,
    priorityTemplate: data.priorityTemplate ?? null,
  });

  await prisma.$transaction([
    prisma.webhookChannel.deleteMany({ where: { webhookId: id } }),
    prisma.webhookChannelGroup.deleteMany({ where: { webhookId: id } }),
    prisma.webhook.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description || null,
        enabled: data.enabled,
        requireAuth: data.requireAuth,
        titleTemplate: templates.titleTemplate ?? null,
        messageTemplate: templates.messageTemplate ?? null,
        tagsTemplate: templates.tagsTemplate ?? null,
        priorityTemplate: templates.priorityTemplate ?? null,
        channels: {
          create: data.channelIds.map((channelId) => ({
            channelId,
            filter: data.channelFilters?.[channelId] ?? undefined,
            level: channelLevel(channelId, data.channelLevels),
            alwaysDeliver: channelAlwaysDeliver(
              channelId,
              data.channelAlwaysDeliveries,
            ),
          })),
        },
        channelGroups: {
          create: channelGroupIds.map((groupId) => ({ groupId })),
        },
      },
    }),
  ]);

  revalidatePath("/webhooks");
  revalidatePath(`/webhooks/${id}`);
  revalidatePath(`/webhooks/${id}/edit`);
}

export async function deleteWebhook(id: string) {
  const { orgId } = await requireAdminOrOwner();

  const existing = await prisma.webhook.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
  });
  if (!existing) throw new Error("Webhook not found");

  // Soft-delete: tombstone the row so Messages/Deliveries retain history.
  // The Webhook UPDATE trigger flushes the receiver cache (/n/:publicId -> 404).
  await prisma.webhook.update({
    where: { id },
    data: { deletedAt: new Date(), enabled: false },
  });
  revalidatePath("/webhooks");
  revalidatePath(`/webhooks/${id}`);
}

export async function regenerateApiKey(id: string) {
  const { orgId } = await requireAdminOrOwner();

  const existing = await prisma.webhook.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
  });
  if (!existing) throw new Error("Webhook not found");

  const webhook = await prisma.webhook.update({
    where: { id },
    data: { apiKey: generateApiKey() },
  });

  revalidatePath("/webhooks");
  return webhook.apiKey;
}

export async function updateWebhookRequireAuth(id: string, requireAuth: boolean) {
  const { orgId } = await requireAdminOrOwner();

  const existing = await prisma.webhook.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
  });
  if (!existing) throw new Error("Webhook not found");

  await prisma.webhook.update({
    where: { id },
    data: { requireAuth },
  });

  revalidatePath("/webhooks");
}

export async function updateWebhookChannels(
  webhookId: string,
  data: {
    channelIds: string[];
    channelGroupIds?: string[];
    channelFilters?: Record<string, FilterDefinition | null>;
    channelLevels?: Record<string, number>;
    channelAlwaysDeliveries?: Record<string, boolean>;
  }
) {
  const { orgId } = await requireAdminOrOwner();

  const existing = await prisma.webhook.findFirst({
    where: { id: webhookId, organizationId: orgId, deletedAt: null },
  });
  if (!existing) throw new Error("Webhook not found");

  validateFilters(data.channelFilters);
  validateChannelLevels(data.channelIds, data.channelLevels);
  await assertChannelsBelongToOrg(data.channelIds, orgId);
  const channelGroupIds = data.channelGroupIds ?? [];
  await assertGroupsBelongToOrg(channelGroupIds, orgId);
  await assertNoDirectGroupOverlap(data.channelIds, channelGroupIds);

  await prisma.$transaction([
    prisma.webhookChannel.deleteMany({ where: { webhookId } }),
    prisma.webhookChannelGroup.deleteMany({ where: { webhookId } }),
    ...data.channelIds.map((channelId) =>
      prisma.webhookChannel.create({
        data: {
          webhookId,
          channelId,
          filter: data.channelFilters?.[channelId] ?? undefined,
          level: channelLevel(channelId, data.channelLevels),
          alwaysDeliver: channelAlwaysDeliver(
            channelId,
            data.channelAlwaysDeliveries,
          ),
        },
      })
    ),
    ...channelGroupIds.map((groupId) =>
      prisma.webhookChannelGroup.create({
        data: { webhookId, groupId },
      }),
    ),
  ]);

  revalidatePath("/webhooks");
  revalidatePath(`/webhooks/${webhookId}`);
  revalidatePath(`/webhooks/${webhookId}/edit`);
}

export async function toggleWebhookChannel(
  webhookId: string,
  channelId: string,
  enabled: boolean
) {
  const { orgId } = await requireAdminOrOwner();

  const existing = await prisma.webhook.findFirst({
    where: { id: webhookId, organizationId: orgId, deletedAt: null },
  });
  if (!existing) throw new Error("Webhook not found");

  await prisma.webhookChannel.update({
    where: { webhookId_channelId: { webhookId, channelId } },
    data: { enabled },
  });

  revalidatePath("/webhooks");
  revalidatePath(`/webhooks/${webhookId}`);
}

export async function toggleWebhookChannelGroup(
  webhookId: string,
  groupId: string,
  enabled: boolean,
) {
  const { orgId } = await requireAdminOrOwner();
  const existing = await prisma.webhook.findFirst({
    where: { id: webhookId, organizationId: orgId, deletedAt: null },
  });
  if (!existing) throw new Error("Webhook not found");

  await prisma.webhookChannelGroup.update({
    where: { webhookId_groupId: { webhookId, groupId } },
    data: { enabled },
  });

  revalidatePath("/webhooks");
  revalidatePath(`/webhooks/${webhookId}`);
}

export async function regeneratePublicId(id: string) {
  const { orgId } = await requireAdminOrOwner();

  const existing = await prisma.webhook.findFirst({
    where: { id, organizationId: orgId, deletedAt: null },
  });
  if (!existing) throw new Error("Webhook not found");

  const webhook = await prisma.webhook.update({
    where: { id },
    data: { publicId: generatePublicId() },
  });

  revalidatePath("/webhooks");
  return webhook.publicId;
}
