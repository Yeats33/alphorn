export interface ExpandedChannelRoute {
  channelId: string;
  enabled: boolean;
  filter: unknown;
  level: number;
  alwaysDeliver: boolean;
  channel: { id: string; enabled: boolean };
}

export interface ChannelGroupRoute {
  enabled: boolean;
  group: {
    enabled: boolean;
    members: ExpandedChannelRoute[];
  };
}

/**
 * Expand reusable strategy groups into the same route shape as direct webhook
 * channels. Direct routes win defensively if stale data contains an overlap;
 * server actions normally prevent that state.
 */
export function expandChannelRoutes(
  directRoutes: ExpandedChannelRoute[],
  groupRoutes: ChannelGroupRoute[],
): ExpandedChannelRoute[] {
  const expanded = new Map(
    directRoutes.map((route) => [route.channelId, route]),
  );

  for (const groupRoute of groupRoutes) {
    if (!groupRoute.enabled || !groupRoute.group.enabled) continue;
    for (const member of groupRoute.group.members) {
      if (!expanded.has(member.channelId)) {
        expanded.set(member.channelId, member);
      }
    }
  }

  return Array.from(expanded.values());
}
