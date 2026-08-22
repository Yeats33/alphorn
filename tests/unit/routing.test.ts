import { describe, expect, it } from "vitest";
import {
  expandChannelRoutes,
  type ExpandedChannelRoute,
} from "@/lib/routing";

function route(
  channelId: string,
  overrides: Partial<ExpandedChannelRoute> = {},
): ExpandedChannelRoute {
  return {
    channelId,
    enabled: true,
    filter: null,
    level: 1,
    alwaysDeliver: false,
    channel: { id: channelId, enabled: true },
    ...overrides,
  };
}

describe("expandChannelRoutes", () => {
  it("expands enabled strategy-group members", () => {
    const result = expandChannelRoutes([], [
      {
        enabled: true,
        group: {
          enabled: true,
          members: [route("frankie"), route("qlal", { level: 2 })],
        },
      },
    ]);

    expect(result.map((item) => [item.channelId, item.level])).toEqual([
      ["frankie", 1],
      ["qlal", 2],
    ]);
  });

  it("ignores disabled group links and disabled groups", () => {
    const result = expandChannelRoutes([], [
      {
        enabled: false,
        group: { enabled: true, members: [route("a")] },
      },
      {
        enabled: true,
        group: { enabled: false, members: [route("b")] },
      },
    ]);

    expect(result).toEqual([]);
  });

  it("keeps a direct route if stale data overlaps a group member", () => {
    const direct = route("shared", { level: 4 });
    const result = expandChannelRoutes([direct], [
      {
        enabled: true,
        group: {
          enabled: true,
          members: [route("shared", { level: 1 })],
        },
      },
    ]);

    expect(result).toEqual([direct]);
  });
});
