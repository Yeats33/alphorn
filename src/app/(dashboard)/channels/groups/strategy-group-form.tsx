"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createChannelGroup,
  deleteChannelGroup,
  updateChannelGroup,
} from "./actions";
import { ChannelSelector } from "@/components/channel-selector";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type ChannelSelection,
  type FilterDefinition,
  validateFilter,
} from "@/lib/filter/schema";
import { showError } from "@/lib/toast-error";
import type { ChannelOption } from "@/channels/types";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

interface StrategyGroupData {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  members: Array<{
    channelId: string;
    filter: unknown;
    level: number;
    alwaysDeliver: boolean;
  }>;
}

export function StrategyGroupForm({
  group,
  channels,
  availableTags,
}: {
  group?: StrategyGroupData;
  channels: ChannelOption[];
  availableTags: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [enabled, setEnabled] = useState(group?.enabled ?? true);
  const [selectedChannels, setSelectedChannels] = useState<ChannelSelection[]>(
    group?.members.map((member) => ({
      channelId: member.channelId,
      filter: (member.filter as FilterDefinition | null) ?? null,
      level: member.level,
      alwaysDeliver: member.alwaysDeliver,
    })) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    for (const selection of selectedChannels) {
      const error = validateFilter(selection.filter);
      if (error) {
        showError(error, "Invalid filter");
        return;
      }
    }

    const data = {
      name,
      description: description || undefined,
      enabled,
      channelIds: selectedChannels.map((selection) => selection.channelId),
      channelFilters: Object.fromEntries(
        selectedChannels.map((selection) => [selection.channelId, selection.filter]),
      ),
      channelLevels: Object.fromEntries(
        selectedChannels.map((selection) => [selection.channelId, selection.level]),
      ),
      channelAlwaysDeliveries: Object.fromEntries(
        selectedChannels.map((selection) => [
          selection.channelId,
          selection.alwaysDeliver,
        ]),
      ),
    };

    setSaving(true);
    try {
      if (group) {
        await updateChannelGroup(group.id, data);
        toast.success("Strategy group updated");
      } else {
        await createChannelGroup(data);
        toast.success("Strategy group created");
      }
      router.push("/channels");
    } catch (error) {
      showError(error, group ? "Failed to update group" : "Failed to create group");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!group) return;
    setDeleting(true);
    try {
      await deleteChannelGroup(group.id);
      toast.success("Strategy group deleted");
      router.push("/channels");
    } catch (error) {
      showError(error, "Failed to delete group");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => router.push("/channels")}
        >
          <ArrowLeft data-icon />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {group ? "Edit strategy group" : "Create strategy group"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reuse channel filters and failover levels across webhooks.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <div className="space-y-2">
          <Label htmlFor="group-name">Name</Label>
          <Input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ntfy personal routing"
            required
            disabled={saving}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="group-description">Description</Label>
          <Textarea
            id="group-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Frankie/Yeats by tag, qlal fallback"
            disabled={saving}
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={saving} />
          <Label>{enabled ? "Active" : "Disabled"}</Label>
        </div>
        <div className="space-y-2">
          <Label>Group members and routing rules</Label>
          <ChannelSelector
            channels={channels}
            selected={selectedChannels}
            onChange={setSelectedChannels}
            availableTags={availableTags}
          />
        </div>
        <div className="flex gap-3">
          <Button type="submit" disabled={saving || deleting}>
            {saving ? "Saving..." : group ? "Save changes" : "Create group"}
          </Button>
          {group && (
            <ConfirmDialog
              trigger={
                <Button
                  type="button"
                  variant="destructive"
                  disabled={saving || deleting}
                >
                  {deleting ? "Deleting..." : "Delete group"}
                </Button>
              }
              title="Delete strategy group?"
              description="Webhooks using this group will stop routing through it. Channels are not deleted."
              confirmLabel="Delete group"
              onConfirm={handleDelete}
            />
          )}
        </div>
      </form>
    </div>
  );
}
