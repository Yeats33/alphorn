import { z } from "zod";
import { registerChannel } from "./registry";
import { fetchWithTimeout } from "./fetch";
import { throwIfNotOk } from "./errors";
import { meta } from "./ntfy.meta";

function toNtfyPriorityId(priority: number): number {
  return Math.min(5, Math.max(1, Math.round(priority)));
}

const configSchema = z.object({
  serverUrl: z
    .string()
    .url("Must be a valid URL")
    .default("https://ntfy.sh"),
  topic: z
    .string()
    .min(1, "Topic is required")
    .max(64, "Topic must be 64 characters or fewer")
    .regex(
      /^[-_A-Za-z0-9]+$/,
      "Topic may contain only letters, numbers, underscores, and dashes",
    ),
  accessToken: z.string().optional(),
});

registerChannel({
  ...meta,
  configSchema,
  async send(config, notification) {
    const { serverUrl, topic, accessToken } = config;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const payload: Record<string, unknown> = {
      topic,
      message: notification.message,
    };
    if (notification.title) payload.title = notification.title;
    if (notification.priority != null) {
      // ntfy defines priority IDs 1..5 (min, low, default, high, max). Convert
      // at the provider boundary and keep all ntfy-specific rules local here.
      payload.priority = toNtfyPriorityId(notification.priority);
    }
    if (notification.tags?.length) {
      payload.tags = notification.tags;
    }
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }
    const res = await fetchWithTimeout(
      `${serverUrl.replace(/\/+$/, "")}/`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }
    );
    await throwIfNotOk(res, "Ntfy");
  },
});
