import { prisma } from "@/lib/db";
import { getQueue, DELIVERY_QUEUE } from "@/lib/queue";
import { logger as rootLogger } from "@/lib/logger";
import { advanceFailoverIfLevelFailed } from "./failover";

const logger = rootLogger.child({ component: "worker", task: "sweep" });

const SWEEP_INTERVAL_MS = 60_000;
const REENQUEUE_AFTER_MS = 120_000; // re-enqueue PENDING deliveries after 2 min
const STALE_AFTER_MS = 300_000;     // mark as STALE after 5 min — give up

/**
 * Periodically find orphaned deliveries (created in DB but never picked up)
 * and either re-enqueue them or mark them STALE.
 */
export function startSweep() {
  const interval = setInterval(async () => {
    try {
      await markStaleDeliveries();
      await reenqueueOrphanedDeliveries();
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, "Sweep failed");
    }
  }, SWEEP_INTERVAL_MS);

  interval.unref();
  logger.info({ intervalMs: SWEEP_INTERVAL_MS }, "Orphan sweep started");
}

/**
 * Deliveries still PENDING with 0 attempts five minutes after creation or
 * failover activation are beyond recovery.
 * Mark them STALE so they show up in the dashboard as undelivered.
 */
async function markStaleDeliveries() {
  const staleThreshold = new Date(Date.now() - STALE_AFTER_MS);

  const candidates = await prisma.delivery.findMany({
    where: {
      status: "PENDING",
      attempts: 0,
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, messageId: true, level: true, alwaysDeliver: true },
    take: 500,
  });
  if (candidates.length === 0) return;

  const { count } = await prisma.delivery.updateMany({
    where: {
      id: { in: candidates.map((delivery) => delivery.id) },
      status: "PENDING",
      attempts: 0,
    },
    data: {
      status: "STALE",
      lastError: "Delivery was never picked up by a worker",
    },
  });

  if (count > 0) {
    logger.warn({ count, staleDurationMs: STALE_AFTER_MS }, "Marked stale deliveries");
    const levels = new Map<string, { messageId: string; level: number }>();
    for (const delivery of candidates) {
      if (delivery.alwaysDeliver) continue;
      levels.set(`${delivery.messageId}:${delivery.level}`, {
        messageId: delivery.messageId,
        level: delivery.level,
      });
    }
    await Promise.all(
      Array.from(levels.values()).map(({ messageId, level }) =>
        advanceFailoverIfLevelFailed({
          messageId,
          failedLevel: level,
        }),
      ),
    );
  }
}

/**
 * Deliveries PENDING with 0 attempts for 2–5 minutes get re-enqueued.
 * They were likely created in the DB but the pg-boss insert failed.
 */
async function reenqueueOrphanedDeliveries() {
  const reenqueueThreshold = new Date(Date.now() - REENQUEUE_AFTER_MS);
  const staleThreshold = new Date(Date.now() - STALE_AFTER_MS);

  const orphaned = await prisma.delivery.findMany({
    where: {
      status: "PENDING",
      attempts: 0,
      updatedAt: {
        lt: reenqueueThreshold,
        gte: staleThreshold,
      },
    },
    select: { id: true },
    take: 500,
  });

  if (orphaned.length === 0) return;

  const queue = await getQueue();
  await queue.insert(
    DELIVERY_QUEUE,
    orphaned.map((d) => ({ data: { deliveryId: d.id } })),
  );

  logger.info({ count: orphaned.length }, "Re-enqueued orphaned deliveries");
}
