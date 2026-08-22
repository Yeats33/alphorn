import { z } from "zod";
import { registerChannel } from "./registry";
import { fetchWithTimeout } from "./fetch";
import { throwIfNotOk } from "./errors";
import { meta } from "./nekoko-sms.meta";

const configSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  from: z.string().min(1, "From number is required"),
  to: z.string().min(1, "To number is required"),
});

export function buildNekokoSmsUrl(config: z.infer<typeof configSchema>, body: string): URL {
  const url = new URL(
    `https://api.nekoko.tel/sms/send/${encodeURIComponent(config.to)}`
  );
  url.search = new URLSearchParams({
    apikey: config.apiKey,
    from: config.from,
    body,
  }).toString();
  return url;
}

registerChannel({
  ...meta,
  configSchema,
  async send(config, notification) {
    const body = notification.title
      ? `${notification.title}: ${notification.message}`
      : notification.message;
    const res = await fetchWithTimeout(buildNekokoSmsUrl(config, body), {
      method: "GET",
    });
    await throwIfNotOk(res, "Nekoko SMS");
  },
});
