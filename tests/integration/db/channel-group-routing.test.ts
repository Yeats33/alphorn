import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { prisma } from "@/lib/db";
import { flushWebhookCache, getCachedWebhook } from "@/lib/webhook-cache";

describe("strategy-group routing — integration", () => {
  it("expands reusable member rules and reflects later group edits", async () => {
    const organizationId = `org_${nanoid(10)}`;
    await prisma.organization.create({
      data: { id: organizationId, name: "Strategy group org" },
    });

    const channels = await Promise.all(
      ["frankie", "yeats", "qlal", "archive"].map((name) =>
        prisma.channel.create({
          data: {
            id: `ch_${nanoid(10)}`,
            name,
            type: "integration-test-channel",
            config: {},
            publicId: nanoid(12),
            organizationId,
          },
        }),
      ),
    );

    const group = await prisma.channelGroup.create({
      data: {
        id: `cg_${nanoid(10)}`,
        name: "Ntfy routing",
        organizationId,
        members: {
          create: [
            {
              channelId: channels[0]!.id,
              level: 1,
              filter: {
                groups: [
                  {
                    conditions: [
                      {
                        field: "tags",
                        operator: "has_any_of",
                        value: ["frankie"],
                      },
                    ],
                  },
                ],
              },
            },
            {
              channelId: channels[1]!.id,
              level: 1,
              filter: {
                groups: [
                  {
                    conditions: [
                      {
                        field: "tags",
                        operator: "has_any_of",
                        value: ["yeats"],
                      },
                    ],
                  },
                ],
              },
            },
            { channelId: channels[2]!.id, level: 2 },
          ],
        },
      },
    });

    const publicId = nanoid(12);
    await prisma.webhook.create({
      data: {
        id: `wh_${nanoid(10)}`,
        name: "Grouped webhook",
        apiKey: `key_${nanoid(20)}`,
        publicId,
        organizationId,
        channels: {
          create: {
            channelId: channels[3]!.id,
            level: 1,
            alwaysDeliver: true,
          },
        },
        channelGroups: { create: { groupId: group.id } },
      },
    });

    const first = await getCachedWebhook(publicId);
    expect(first?.channels).toHaveLength(4);
    expect(
      first?.channels.map((route) => ({
        channelId: route.channelId,
        level: route.level,
        alwaysDeliver: route.alwaysDeliver,
      })),
    ).toEqual(
      expect.arrayContaining([
        { channelId: channels[0]!.id, level: 1, alwaysDeliver: false },
        { channelId: channels[1]!.id, level: 1, alwaysDeliver: false },
        { channelId: channels[2]!.id, level: 2, alwaysDeliver: false },
        { channelId: channels[3]!.id, level: 1, alwaysDeliver: true },
      ]),
    );

    await prisma.channelGroupMember.update({
      where: {
        groupId_channelId: { groupId: group.id, channelId: channels[2]!.id },
      },
      data: { level: 3 },
    });
    flushWebhookCache();

    const updated = await getCachedWebhook(publicId);
    expect(
      updated?.channels.find((route) => route.channelId === channels[2]!.id)
        ?.level,
    ).toBe(3);
  });
});
