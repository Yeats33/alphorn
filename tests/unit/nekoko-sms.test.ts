import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PermanentChannelError } from "@/channels/errors";
import type { ChannelHandler } from "@/channels/types";

const notification = {
  title: "Deploy complete",
  message: "Version 2.1 + fixes",
};
const context = { channelId: "channel-1", deliveryId: "delivery-1" };
const config = {
  apiKey: "key with + and &",
  from: "37250000001",
  to: "+37250000002",
};

let handler: ChannelHandler<unknown>;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  await import("@/channels/nekoko-sms");
  const { getChannel } = await import("@/channels/registry");
  handler = getChannel("nekoko-sms")!;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("Nekoko SMS channel", () => {
  it("sends an encoded GET request using the notification text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await handler.send(config, notification, context);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const url = new URL(input);
    expect(url.origin).toBe("https://api.nekoko.tel");
    expect(decodeURIComponent(url.pathname)).toBe("/sms/send/+37250000002");
    expect(url.searchParams.get("apikey")).toBe(config.apiKey);
    expect(url.searchParams.get("from")).toBe(config.from);
    expect(url.searchParams.get("body")).toBe(
      "Deploy complete: Version 2.1 + fixes"
    );
    expect(init).toEqual({
      method: "GET",
      signal: expect.any(AbortSignal),
    });
  });

  it("treats a rejected request as a permanent channel error", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response("invalid API key", { status: 401 })) as unknown as typeof fetch;

    await expect(handler.send(config, notification, context)).rejects.toBeInstanceOf(
      PermanentChannelError
    );
  });
});
