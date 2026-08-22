import { prisma } from "@/lib/db";
import { DELIVERY_QUEUE, getQueue } from "@/lib/queue";
import { logger as rootLogger } from "@/lib/logger";

const logger = rootLogger.child({ component: "worker", task: "failover" });

export type FailoverState =
  | "advanced"
  | "active"
  | "succeeded"
  | "exhausted";

export interface FailoverResult {
  state: FailoverState;
  promotedLevel?: number;
  promotedDeliveryIds?: string[];
}

interface AdvanceFailoverInput {
  messageId: string;
  failedLevel: number;
  trace?: string[];
}

/**
 * Promote the next waiting delivery level once every delivery in the failed
 * level is terminal. A row lock on Message serializes concurrent failures from
 * channels in the same level, so the next level is activated exactly once.
 */
export async function advanceFailoverIfLevelFailed({
  messageId,
  failedLevel,
  trace,
}: AdvanceFailoverInput): Promise<FailoverResult> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "Message"
      WHERE "id" = ${messageId}::uuid
      FOR UPDATE
    `;

    const delivered = await tx.delivery.count({
      where: { messageId, status: "DELIVERED" },
    });
    if (delivered > 0) {
      await tx.delivery.updateMany({
        where: { messageId, status: "WAITING" },
        data: { status: "SKIPPED" },
      });
      return { state: "succeeded" as const };
    }

    const currentLevelActive = await tx.delivery.count({
      where: {
        messageId,
        level: failedLevel,
        status: { in: ["WAITING", "PENDING", "PROCESSING", "RETRYING"] },
      },
    });
    if (currentLevelActive > 0) {
      return { state: "active" as const };
    }

    const higherLevelActive = await tx.delivery.count({
      where: {
        messageId,
        level: { gt: failedLevel },
        status: { in: ["PENDING", "PROCESSING", "RETRYING"] },
      },
    });
    if (higherLevelActive > 0) {
      return { state: "active" as const };
    }

    const next = await tx.delivery.findFirst({
      where: {
        messageId,
        level: { gt: failedLevel },
        status: "WAITING",
      },
      orderBy: { level: "asc" },
      select: { level: true },
    });
    if (!next) {
      return { state: "exhausted" as const };
    }

    const promoted = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "Delivery"
      SET
        "status" = 'PENDING'::"DeliveryStatus",
        "updatedAt" = now()
      WHERE
        "messageId" = ${messageId}::uuid
        AND "level" = ${next.level}
        AND "status" = 'WAITING'::"DeliveryStatus"
      RETURNING "id"::text
    `;

    return {
      state: "advanced" as const,
      promotedLevel: next.level,
      promotedDeliveryIds: promoted.map((delivery) => delivery.id),
    };
  });

  if (result.state !== "advanced" || !result.promotedDeliveryIds?.length) {
    return result;
  }

  try {
    const queue = await getQueue();
    await queue.insert(
      DELIVERY_QUEUE,
      result.promotedDeliveryIds.map((deliveryId) => ({
        data: {
          deliveryId,
          ...(trace !== undefined ? { trace } : {}),
        },
      })),
    );
  } catch (error) {
    // The promoted rows stay PENDING. The orphan sweep will enqueue them after
    // its normal grace period, so a transient queue outage cannot lose them.
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        messageId,
        promotedLevel: result.promotedLevel,
      },
      "Failed to enqueue promoted failover level",
    );
  }

  logger.info(
    {
      messageId,
      failedLevel,
      promotedLevel: result.promotedLevel,
      deliveryCount: result.promotedDeliveryIds.length,
    },
    "Promoted failover level",
  );
  return result;
}
