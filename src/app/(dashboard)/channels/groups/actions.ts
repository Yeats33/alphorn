"use server";

import { prisma } from "@/lib/db";
import { generateChannelGroupId } from "@/lib/api-key";
import { requireAdminOrOwner, requireSession } from "@/lib/auth/server";
import {
  FilterDefinition as FilterDefinitionSchema,
  type FilterDefinition,
} from "@/lib/filter/schema";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const levelSchema = z.number().int().min(1).max(99);

interface GroupInput {
  name: string;
  description?: string;
  enabled?: boolean;
  channelIds: string[];
  channelFilters?: Record<string, FilterDefinition | null>;
  channelLevels?: Record<string, number>;
  channelAlwaysDeliveries?: Record<string, boolean>;
}

function validateMemberSettings(data: GroupInput) {
  if (data.channelIds.length === 0) {
    throw new Error("Select at least one channel");
  }
  for (const channelId of data.channelIds) {
    levelSchema.parse(data.channelLevels?.[channelId] ?? 1);
    z.boolean().parse(data.channelAlwaysDeliveries?.[channelId] ?? false);
    const filter = data.channelFilters?.[channelId] ?? null;
    if (filter !== null) FilterDefinitionSchema.parse(filter);
  }
}

async function assertChannelsAvailable(
  channelIds: string[],
  orgId: string,
  currentGroupId?: string,
) {
  const unique = Array.from(new Set(channelIds));
  const channels = await prisma.channel.findMany({
    where: { id: { in: unique }, organizationId: orgId },
    select: {
      id: true,
      groupMembership: { select: { groupId: true } },
    },
  });
  if (channels.length !== unique.length) {
    throw new Error("One or more channels do not belong to this project");
  }
  const occupied = channels.find(
    (channel) =>
      channel.groupMembership &&
      channel.groupMembership.groupId !== currentGroupId,
  );
  if (occupied) {
    throw new Error("A channel can belong to only one strategy group");
  }
}

async function assertNoLinkedWebhookOverlap(
  groupId: string,
  channelIds: string[],
) {
  if (channelIds.length === 0) return;
  const overlap = await prisma.webhookChannel.findFirst({
    where: {
      channelId: { in: channelIds },
      webhook: { channelGroups: { some: { groupId } } },
    },
    select: { channelId: true },
  });
  if (overlap) {
    throw new Error(
      "A linked webhook already uses one of these channels directly; remove the direct route first",
    );
  }
}

function memberData(channelId: string, data: GroupInput) {
  return {
    channelId,
    filter: data.channelFilters?.[channelId] ?? undefined,
    level: levelSchema.parse(data.channelLevels?.[channelId] ?? 1),
    alwaysDeliver: data.channelAlwaysDeliveries?.[channelId] ?? false,
  };
}

export async function getChannelGroupsForOrg() {
  const session = await requireSession();
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return [];

  return prisma.channelGroup.findMany({
    where: { organizationId: orgId },
    include: {
      members: {
        include: { channel: { select: { id: true, name: true, type: true } } },
        orderBy: [{ level: "asc" }, { channelId: "asc" }],
      },
      _count: { select: { webhooks: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getChannelGroupById(id: string) {
  const session = await requireSession();
  const orgId = session.session.activeOrganizationId;
  if (!orgId) return null;

  return prisma.channelGroup.findFirst({
    where: { id, organizationId: orgId },
    include: {
      members: {
        include: { channel: { select: { id: true, name: true, type: true } } },
        orderBy: [{ level: "asc" }, { channelId: "asc" }],
      },
    },
  });
}

export async function createChannelGroup(data: GroupInput) {
  const { orgId } = await requireAdminOrOwner();
  validateMemberSettings(data);
  await assertChannelsAvailable(data.channelIds, orgId);

  const group = await prisma.channelGroup.create({
    data: {
      id: generateChannelGroupId(),
      name: z.string().trim().min(1).max(100).parse(data.name),
      description: data.description?.trim() || null,
      organizationId: orgId,
      enabled: data.enabled ?? true,
      members: {
        create: data.channelIds.map((channelId) => memberData(channelId, data)),
      },
    },
  });

  revalidatePath("/channels");
  return group;
}

export async function updateChannelGroup(id: string, data: GroupInput) {
  const { orgId } = await requireAdminOrOwner();
  const existing = await prisma.channelGroup.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) throw new Error("Strategy group not found");

  validateMemberSettings(data);
  await assertChannelsAvailable(data.channelIds, orgId, id);
  await assertNoLinkedWebhookOverlap(id, data.channelIds);

  await prisma.$transaction([
    prisma.channelGroupMember.deleteMany({ where: { groupId: id } }),
    prisma.channelGroup.update({
      where: { id },
      data: {
        name: z.string().trim().min(1).max(100).parse(data.name),
        description: data.description?.trim() || null,
        enabled: data.enabled ?? true,
        members: {
          create: data.channelIds.map((channelId) => memberData(channelId, data)),
        },
      },
    }),
  ]);

  revalidatePath("/channels");
  revalidatePath(`/channels/groups/${id}/edit`);
  revalidatePath("/webhooks");
}

export async function deleteChannelGroup(id: string) {
  const { orgId } = await requireAdminOrOwner();
  const existing = await prisma.channelGroup.findFirst({
    where: { id, organizationId: orgId },
  });
  if (!existing) throw new Error("Strategy group not found");

  await prisma.channelGroup.delete({ where: { id } });
  revalidatePath("/channels");
  revalidatePath("/webhooks");
}
