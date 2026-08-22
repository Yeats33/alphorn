import { prisma } from "./db";
import { getQueue, DELIVERY_QUEUE } from "./queue";

export interface DeliveryTarget {
  channelId: string;
  level: number;
}

export interface PersistMessageInput {
  webhookId: string;
  title: string | null;
  message: string;
  priority: number | null;
  tags: string[];
  payload: Record<string, unknown> | null;
  channels: DeliveryTarget[];
  trace?: string[];
}

export async function persistMessageAndEnqueueDeliveries(
  input: PersistMessageInput,
): Promise<{ messageId: string }> {
  const { webhookId, title, message, priority, tags, payload, channels, trace } =
    input;
  const activeLevel =
    channels.length > 0 ? Math.min(...channels.map((channel) => channel.level)) : null;
  const channelIds = channels.map((channel) => channel.channelId);
  const channelLevels = channels.map((channel) => channel.level);

  // Warm the queue client while we write so its start-up overlaps with the DB.
  const queuePromise = channels.length > 0 ? getQueue() : null;

  const payloadJson = JSON.stringify(payload ?? {});

  // One round-trip: insert the Message and all Deliveries via a CTE, and
  // return both the message id and the freshly-minted delivery ids. This
  // replaces an interactive $transaction (BEGIN + 2 inserts + COMMIT = 4 RT)
  // plus a follow-up findMany readback.
  const rows = await prisma.$queryRaw<
    Array<{ messageId: string; queuedDeliveryIds: string[] }>
  >`
    WITH m AS (
      INSERT INTO "Message"
        ("webhookId", "title", "message", "priority", "tags", "payload")
      VALUES
        (${webhookId}, ${title}, ${message}, ${priority}::int,
         ${tags}::text[], ${payloadJson}::jsonb)
      RETURNING "id"
    ),
    d AS (
      INSERT INTO "Delivery" ("messageId", "channelId", "level", "status", "updatedAt")
      SELECT
        m."id",
        c.channel_id,
        c.level,
        CASE
          WHEN c.level = ${activeLevel} THEN 'PENDING'::"DeliveryStatus"
          ELSE 'WAITING'::"DeliveryStatus"
        END,
        now()
      FROM m
      CROSS JOIN unnest(${channelIds}::text[], ${channelLevels}::int[])
        AS c(channel_id, level)
      RETURNING "id", "status"
    )
    SELECT
      m."id"::text AS "messageId",
      COALESCE(
        (SELECT array_agg(d."id"::text) FROM d WHERE d."status" = 'PENDING'),
        ARRAY[]::text[]
      ) AS "queuedDeliveryIds"
    FROM m
  `;

  const { messageId, queuedDeliveryIds } = rows[0];

  if (queuePromise && queuedDeliveryIds.length > 0) {
    const queue = await queuePromise;
    await queue.insert(
      DELIVERY_QUEUE,
      queuedDeliveryIds.map((id) => ({
        data: {
          deliveryId: id,
          ...(trace !== undefined ? { trace } : {}),
        },
      })),
    );
  }

  return { messageId };
}
