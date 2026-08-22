import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChannelHandler } from "@/channels/types";

let handler: ChannelHandler<unknown>;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  await import("@/channels/ntfy");
  const { getChannel } = await import("@/channels/registry");
  handler = getChannel("ntfy")!;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const config = {
  serverUrl: "https://ntfy.example.com",
  topic: "alerts",
  accessToken: "tk_test",
};

const context = { channelId: "channel", deliveryId: "delivery" };

async function sendWithPriority(priority?: number) {
  const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  await handler.send(
    config,
    { title: "Alert", message: "Test", priority },
    context
  );

  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, headers: init.headers as Record<string, string> };
}

describe("ntfy channel", () => {
  it.each([1, 2, 3, 4, 5])(
    "maps Alphorn priority %i to the matching ntfy priority ID",
    async (priority) => {
      const { headers } = await sendWithPriority(priority);
      expect(headers["X-Priority"]).toBe(String(priority));
    }
  );

  it.each([
    [0, "1"],
    [3.6, "4"],
    [9, "5"],
  ])("normalizes priority %s to ntfy priority %s", async (priority, expected) => {
    const { headers } = await sendWithPriority(priority as number);
    expect(headers["X-Priority"]).toBe(expected);
  });

  it("omits priority when Alphorn did not provide one", async () => {
    const { headers } = await sendWithPriority();
    expect(headers["X-Priority"]).toBeUndefined();
  });

  it("keeps the ntfy URL and bearer authentication unchanged", async () => {
    const { url, headers } = await sendWithPriority(4);
    expect(url).toBe("https://ntfy.example.com/alerts");
    expect(headers.Authorization).toBe("Bearer tk_test");
  });
});
