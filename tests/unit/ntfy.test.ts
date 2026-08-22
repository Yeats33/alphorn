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
  return {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
  };
}

describe("ntfy channel", () => {
  it.each([1, 2, 3, 4, 5])(
    "maps Alphorn priority %i to the matching ntfy priority ID",
    async (priority) => {
      const { body } = await sendWithPriority(priority);
      expect(body.priority).toBe(priority);
    }
  );

  it.each([
    [0, 1],
    [3.6, 4],
    [9, 5],
  ])("normalizes priority %s to ntfy priority %s", async (priority, expected) => {
    const { body } = await sendWithPriority(priority as number);
    expect(body.priority).toBe(expected);
  });

  it("omits priority when Alphorn did not provide one", async () => {
    const { body } = await sendWithPriority();
    expect(body.priority).toBeUndefined();
  });

  it("keeps the ntfy URL and bearer authentication unchanged", async () => {
    const { url, headers } = await sendWithPriority(4);
    expect(url).toBe("https://ntfy.example.com/alerts");
    expect(headers.Authorization).toBe("Bearer tk_test");
    expect(headers["Content-Type"]).toBe("application/json; charset=utf-8");
  });

  it("sends Unicode title, message, and tags in the UTF-8 JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await handler.send(
      config,
      {
        title: "配置完成",
        message: "中文通知已送达",
        tags: ["完成", "通知"],
      },
      context,
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      title: "配置完成",
      message: "中文通知已送达",
      tags: ["完成", "通知"],
    });
  });
});
