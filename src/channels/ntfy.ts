import { z } from "zod";
import { registerChannel } from "./registry";
import { fetchWithTimeout } from "./fetch";
import { throwIfNotOk } from "./errors";
import { joinUrl } from "./utils";
import { meta } from "./ntfy.meta";

function toNtfyPriorityId(priority: number): string {
  return String(Math.min(5, Math.max(1, Math.round(priority))));
}

const configSchema = z.object({
  serverUrl: z
    .string()
    .url("Must be a valid URL")
    .default("https://ntfy.sh"),
  topic: z.string().min(1, "Topic is required"),
  accessToken: z.string().optional(),
});

registerChannel({
  ...meta,
  configSchema,
  async send(config, notification) {
    const { serverUrl, topic, accessToken } = config;
    const headers: Record<string, string> = {};
    if (notification.title) {
      headers["X-Title"] = notification.title;
    }
    if (notification.priority != null) {
      // ntfy defines priority IDs 1..5 (min, low, default, high, max). Convert
      // at the provider boundary and keep all ntfy-specific rules local here.
      headers["X-Priority"] = toNtfyPriorityId(notification.priority);
    }
    if (notification.tags?.length) {
      headers["X-Tags"] = notification.tags.join(",");
    }
    if (accessToken) {
      headers["Authorization"] = `Bearer ${accessToken}`;
    }
    const res = await fetchWithTimeout(
      joinUrl(serverUrl, topic),
      {
        method: "POST",
        headers,
        body: notification.message,
      }
    );
    await throwIfNotOk(res, "Ntfy");
  },
});
