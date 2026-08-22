import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { prisma } from "@/lib/db";
import { handleDelivery } from "@/worker/deliver";
import { createDeliveryFixture } from "../helpers/factories";
import { DELIVERY_QUEUE, getQueue } from "@/lib/queue";
import {
  setTestChannelBehavior,
  testChannelCalls,
} from "../helpers/test-channel";

const MAX_RETRIES = 5;

async function getDelivery(id: string) {
  const row = await prisma.delivery.findUniqueOrThrow({ where: { id } });
  return row;
}

async function addDelivery(
  fixture: Awaited<ReturnType<typeof createDeliveryFixture>>,
  level: number,
  status: "PENDING" | "WAITING",
  alwaysDeliver = false,
) {
  const channel = await prisma.channel.create({
    data: {
      id: `ch_${nanoid(10)}`,
      name: `Fallback level ${level}`,
      type: "integration-test-channel",
      config: { label: `level-${level}` },
      publicId: nanoid(12),
      organizationId: fixture.organizationId,
    },
  });
  return prisma.delivery.create({
    data: {
      messageId: fixture.messageId,
      channelId: channel.id,
      level,
      alwaysDeliver,
      status,
    },
  });
}

describe("handleDelivery — worker integration", () => {
  it("marks the delivery DELIVERED on channel success and records one send call", async () => {
    const { deliveryId } = await createDeliveryFixture();

    await handleDelivery({ deliveryId });

    const row = await getDelivery(deliveryId);
    expect(row.status).toBe("DELIVERED");
    expect(row.attempts).toBe(1);
    expect(row.deliveredAt).toBeInstanceOf(Date);
    expect(row.lastError).toBeNull();

    const calls = testChannelCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.notification.message).toBe("World");
    expect(calls[0]!.context.deliveryId).toBe(deliveryId);
  });

  it("records FAILED and re-throws on a transient error when attempts remain", async () => {
    const { deliveryId } = await createDeliveryFixture();
    setTestChannelBehavior({ kind: "transient", message: "gateway 502" });

    await expect(handleDelivery({ deliveryId })).rejects.toThrow("gateway 502");

    const row = await getDelivery(deliveryId);
    expect(row.status).toBe("RETRYING");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("gateway 502");
    expect(row.deliveredAt).toBeNull();
  });

  it("stops re-throwing once attempts reach MAX_RETRIES", async () => {
    const { deliveryId } = await createDeliveryFixture();
    await prisma.delivery.update({
      where: { id: deliveryId },
      data: { attempts: MAX_RETRIES - 1 },
    });
    setTestChannelBehavior({ kind: "transient", message: "still flaky" });

    // The Nth attempt increments to MAX_RETRIES and must NOT re-throw
    // (pg-boss would otherwise keep retrying past the terminal state).
    await expect(handleDelivery({ deliveryId })).resolves.toBeUndefined();

    const row = await getDelivery(deliveryId);
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(MAX_RETRIES);
    expect(row.lastError).toBe("still flaky");
  });

  it("treats PermanentChannelError as terminal on the first attempt", async () => {
    const { deliveryId } = await createDeliveryFixture();
    setTestChannelBehavior({
      kind: "permanent",
      message: "invalid webhook URL",
    });

    await expect(handleDelivery({ deliveryId })).resolves.toBeUndefined();

    const row = await getDelivery(deliveryId);
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("invalid webhook URL");
  });

  it("fails without throwing when the channel type is unknown", async () => {
    const { deliveryId } = await createDeliveryFixture({
      channelType: "not-a-real-channel-type",
    });

    await expect(handleDelivery({ deliveryId })).resolves.toBeUndefined();

    const row = await getDelivery(deliveryId);
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toContain("Unknown channel type");
    // attempt counter still bumps so we can see how many times pg-boss picked it up
    expect(row.attempts).toBe(1);
    expect(testChannelCalls()).toHaveLength(0);
  });

  it("throws when the deliveryId does not exist", async () => {
    await expect(
      handleDelivery({ deliveryId: "00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow(/not found/);
  });

  it("propagates the trace context argument into the channel call", async () => {
    const { deliveryId } = await createDeliveryFixture();
    const trace = ["upstream_public_id"];

    await handleDelivery({ deliveryId, trace });

    const [call] = testChannelCalls();
    expect(call!.context.trace).toEqual(trace);
  });

  it("skips later levels when any delivery in the active level succeeds", async () => {
    const fixture = await createDeliveryFixture();
    const standby = await addDelivery(fixture, 2, "WAITING");

    await handleDelivery({ deliveryId: fixture.deliveryId });

    expect((await getDelivery(fixture.deliveryId)).status).toBe("DELIVERED");
    expect((await getDelivery(standby.id)).status).toBe("SKIPPED");
    expect(testChannelCalls()).toHaveLength(1);
  });

  it("keeps always delivery results independent from failover", async () => {
    const fixture = await createDeliveryFixture();
    const archive = await addDelivery(fixture, 9, "PENDING", true);
    const fallback = await addDelivery(fixture, 2, "WAITING");

    await handleDelivery({ deliveryId: archive.id });
    expect((await getDelivery(archive.id)).status).toBe("DELIVERED");
    expect((await getDelivery(fallback.id)).status).toBe("WAITING");

    setTestChannelBehavior({ kind: "permanent", message: "primary down" });
    await handleDelivery({ deliveryId: fixture.deliveryId });

    expect((await getDelivery(fixture.deliveryId)).status).toBe("FAILED");
    expect((await getDelivery(fallback.id)).status).toBe("PENDING");
  });

  it("promotes the next level exactly once after every active delivery fails", async () => {
    const fixture = await createDeliveryFixture();
    const peer = await addDelivery(fixture, 1, "PENDING");
    const fallback = await addDelivery(fixture, 2, "WAITING");
    setTestChannelBehavior({ kind: "permanent", message: "provider down" });

    await Promise.all([
      handleDelivery({ deliveryId: fixture.deliveryId }),
      handleDelivery({ deliveryId: peer.id }),
    ]);

    expect((await getDelivery(fixture.deliveryId)).status).toBe("FAILED");
    expect((await getDelivery(peer.id)).status).toBe("FAILED");
    expect((await getDelivery(fallback.id)).status).toBe("PENDING");

    const boss = await getQueue();
    const jobs = await boss.findJobs<{ deliveryId: string }>(DELIVERY_QUEUE, {
      queued: true,
    });
    expect(
      jobs.filter((job) => job.data.deliveryId === fallback.id),
    ).toHaveLength(1);

    setTestChannelBehavior({ kind: "success" });
    await handleDelivery({ deliveryId: fallback.id });
    expect((await getDelivery(fallback.id)).status).toBe("DELIVERED");
  });

  it("does not promote while another delivery in the level is waiting to retry", async () => {
    const fixture = await createDeliveryFixture();
    await addDelivery(fixture, 1, "PENDING").then((delivery) =>
      prisma.delivery.update({
        where: { id: delivery.id },
        data: { status: "RETRYING", attempts: 1 },
      }),
    );
    const fallback = await addDelivery(fixture, 2, "WAITING");
    setTestChannelBehavior({ kind: "permanent", message: "invalid config" });

    await handleDelivery({ deliveryId: fixture.deliveryId });

    expect((await getDelivery(fallback.id)).status).toBe("WAITING");
  });
});
