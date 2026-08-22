"use client";

import { useState } from "react";
import {
  updateWebhookChannels,
  toggleWebhookChannel,
  toggleWebhookChannelGroup,
} from "../actions";
import { getChannelsForOrg } from "../../channels/actions";
import { getChannelGroupsForOrg } from "../../channels/groups/actions";
import { getAllTagsForOrg } from "../../messages/actions";
import { type FilterDefinition, type ChannelSelection, validateFilter } from "@/lib/filter/schema";
import { ChannelSelector } from "@/components/channel-selector";
import {
  StrategyGroupSelector,
  type StrategyGroupOption,
} from "@/components/strategy-group-selector";
import { ChannelIcon } from "@/components/channel-icons";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Filter, Layers3, Pencil } from "lucide-react";
import { toast } from "sonner";
import { showError } from "@/lib/toast-error";
import type { ChannelOption } from "@/channels/types";

interface WebhookChannel {
  channelId: string;
  filter: unknown;
  enabled: boolean;
  level: number;
  alwaysDeliver: boolean;
  channel: { name: string; type: string };
}

interface WebhookChannelsProps {
  webhookId: string;
  channels: WebhookChannel[];
  strategyGroups: WebhookStrategyGroup[];
  isAdminOrOwner: boolean;
}

interface WebhookStrategyGroup {
  groupId: string;
  enabled: boolean;
  group: { id: string; name: string; description: string | null };
}

export function WebhookChannels({
  webhookId,
  channels: initialChannels,
  strategyGroups: initialStrategyGroups,
  isAdminOrOwner,
}: WebhookChannelsProps) {
  const [channels, setChannels] = useState(initialChannels);
  const [strategyGroups, setStrategyGroups] = useState(initialStrategyGroups);
  const [editing, setEditing] = useState(false);
  const [allChannels, setAllChannels] = useState<ChannelOption[]>([]);
  const [allGroups, setAllGroups] = useState<StrategyGroupOption[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<ChannelSelection[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [togglingChannels, setTogglingChannels] = useState<Set<string>>(new Set());
  const [togglingGroups, setTogglingGroups] = useState<Set<string>>(new Set());

  function startEditing() {
    setLoadingOptions(true);
    setEditing(true);
    setSelectedChannels(
      channels.map((wc) => ({
        channelId: wc.channelId,
        filter: (wc.filter as FilterDefinition | null) ?? null,
        level: wc.level,
        alwaysDeliver: wc.alwaysDeliver,
      }))
    );
    setSelectedGroupIds(strategyGroups.map((link) => link.groupId));
    Promise.all([
      getChannelsForOrg(),
      getChannelGroupsForOrg(),
      getAllTagsForOrg(),
    ]).then(([chs, groups, tags]) => {
      setAllChannels(chs.map((c) => ({ id: c.id, name: c.name, type: c.type })));
      setAllGroups(
        groups.map((group) => ({
          id: group.id,
          name: group.name,
          description: group.description,
          memberCount: group.members.length,
        })),
      );
      setAvailableTags(tags);
      setLoadingOptions(false);
    });
  }

  function cancelEditing() {
    setEditing(false);
  }

  async function handleToggle(channelId: string, enabled: boolean) {
    setTogglingChannels((prev) => new Set(prev).add(channelId));
    try {
      await toggleWebhookChannel(webhookId, channelId, enabled);
      setChannels((prev) =>
        prev.map((wc) =>
          wc.channelId === channelId ? { ...wc, enabled } : wc
        )
      );
    } catch (err) {
      showError(err, "Failed to toggle channel");
    } finally {
      setTogglingChannels((prev) => {
        const next = new Set(prev);
        next.delete(channelId);
        return next;
      });
    }
  }

  async function handleToggleGroup(groupId: string, enabled: boolean) {
    setTogglingGroups((previous) => new Set(previous).add(groupId));
    try {
      await toggleWebhookChannelGroup(webhookId, groupId, enabled);
      setStrategyGroups((previous) =>
        previous.map((link) =>
          link.groupId === groupId ? { ...link, enabled } : link,
        ),
      );
    } catch (error) {
      showError(error, "Failed to toggle strategy group");
    } finally {
      setTogglingGroups((previous) => {
        const next = new Set(previous);
        next.delete(groupId);
        return next;
      });
    }
  }

  async function handleSave() {
    for (const sel of selectedChannels) {
      const err = validateFilter(sel.filter);
      if (err) {
        showError(err, "Invalid filter");
        return;
      }
    }

    setSaving(true);
    try {
      await updateWebhookChannels(webhookId, {
        channelIds: selectedChannels.map((s) => s.channelId),
        channelGroupIds: selectedGroupIds,
        channelFilters: Object.fromEntries(
          selectedChannels.map((s) => [s.channelId, s.filter])
        ),
        channelLevels: Object.fromEntries(
          selectedChannels.map((s) => [s.channelId, s.level])
        ),
        channelAlwaysDeliveries: Object.fromEntries(
          selectedChannels.map((s) => [s.channelId, s.alwaysDeliver])
        ),
      });
      const currentById = new Map(
        channels.map((channel) => [channel.channelId, channel]),
      );
      const optionById = new Map(
        allChannels.map((channel) => [channel.id, channel]),
      );
      setChannels(
        selectedChannels.map((selection) => {
          const current = currentById.get(selection.channelId);
          const option = optionById.get(selection.channelId);
          return {
            channelId: selection.channelId,
            filter: selection.filter,
            level: selection.level,
            alwaysDeliver: selection.alwaysDeliver,
            enabled: current?.enabled ?? true,
            channel: {
              name: current?.channel.name ?? option?.name ?? selection.channelId,
              type: current?.channel.type ?? option?.type ?? "unknown",
            },
          };
        }),
      );
      const currentGroupsById = new Map(
        strategyGroups.map((link) => [link.groupId, link]),
      );
      const optionsById = new Map(allGroups.map((group) => [group.id, group]));
      setStrategyGroups(
        selectedGroupIds.map((groupId) => {
          const current = currentGroupsById.get(groupId);
          const option = optionsById.get(groupId);
          return {
            groupId,
            enabled: current?.enabled ?? true,
            group: {
              id: groupId,
              name: current?.group.name ?? option?.name ?? groupId,
              description:
                current?.group.description ?? option?.description ?? null,
            },
          };
        }),
      );
      toast.success("Channels updated");
      setEditing(false);
    } catch (err) {
      showError(err, "Failed to update channels");
    } finally {
      setSaving(false);
    }
  }

  const channelGroups = [
    {
      key: "always",
      label: "Always",
      detail: "Independent",
      channels: channels.filter((channel) => channel.alwaysDeliver),
    },
    ...Array.from(
      new Set(
        channels
          .filter((channel) => !channel.alwaysDeliver)
          .map((channel) => channel.level),
      ),
    )
      .sort((a, b) => a - b)
      .map((level) => ({
        key: `level-${level}`,
        label: `Level ${level}`,
        detail: level === 1 ? "Primary" : "Fallback",
        channels: channels.filter(
          (channel) => !channel.alwaysDeliver && channel.level === level,
        ),
      })),
  ].filter((group) => group.channels.length > 0);

  if (editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Output Channels</CardTitle>
          <CardDescription>
            Select channels, configure filters, assign failover levels, or mark
            independent channels as Always.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingOptions ? (
            <p className="text-sm text-muted-foreground">Loading channels...</p>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm font-medium">Strategy groups</p>
                <StrategyGroupSelector
                  groups={allGroups}
                  selectedIds={selectedGroupIds}
                  onChange={setSelectedGroupIds}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Direct channels</p>
                <ChannelSelector
                  channels={allChannels}
                  selected={selectedChannels}
                  onChange={setSelectedChannels}
                  availableTags={availableTags}
                />
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving || loadingOptions}>
              {saving ? "Saving..." : "Save channels"}
            </Button>
            <Button variant="outline" onClick={cancelEditing} disabled={saving}>
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Output Channels</CardTitle>
            <CardDescription>
              Strategy groups expand reusable policies. Direct channels follow
              their configured failover levels; Always routes run independently.
            </CardDescription>
          </div>
          {isAdminOrOwner && (
            <Button variant="outline" size="sm" onClick={startEditing}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {channels.length === 0 && strategyGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No channels linked.{" "}
            {isAdminOrOwner && (
              <button
                onClick={startEditing}
                className="text-primary underline"
              >
                Add channels
              </button>
            )}
          </p>
        ) : (
          <div className="space-y-4">
            {strategyGroups.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Strategy groups
                </p>
                {strategyGroups.map((link) => (
                  <div
                    key={link.groupId}
                    className="flex items-center gap-3 rounded-md border px-3 py-2"
                  >
                    <Layers3 className="h-5 w-5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-none">
                        {link.group.name}
                      </p>
                      {link.group.description && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {link.group.description}
                        </p>
                      )}
                    </div>
                    {isAdminOrOwner && (
                      <Switch
                        checked={link.enabled}
                        disabled={togglingGroups.has(link.groupId)}
                        onCheckedChange={(checked) =>
                          handleToggleGroup(link.groupId, checked)
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            {channelGroups.map((group) => (
                <div key={group.key} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {group.detail}
                    </span>
                  </div>
                  {group.channels.map((wc) => (
                      <div
                        key={wc.channelId}
                        className="flex items-center gap-3 rounded-md border px-3 py-2"
                      >
                        <ChannelIcon
                          icon={wc.channel.type}
                          className="h-5 w-5 shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-none">
                            {wc.channel.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {wc.channel.type}
                          </p>
                        </div>
                        {wc.filter ? (
                          <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : null}
                        {isAdminOrOwner && (
                          <Switch
                            checked={wc.enabled}
                            disabled={togglingChannels.has(wc.channelId)}
                            onCheckedChange={(checked) =>
                              handleToggle(wc.channelId, checked)
                            }
                          />
                        )}
                      </div>
                    ))}
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
