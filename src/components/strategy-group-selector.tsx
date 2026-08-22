"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Layers3 } from "lucide-react";

export interface StrategyGroupOption {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
}

export function StrategyGroupSelector({
  groups,
  selectedIds,
  onChange,
}: {
  groups: StrategyGroupOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No strategy groups configured. Create one under Channels first.
      </p>
    );
  }

  function toggle(id: string) {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id],
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const selected = selectedIds.includes(group.id);
        return (
          <label
            key={group.id}
            className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-accent"
          >
            <Checkbox checked={selected} onCheckedChange={() => toggle(group.id)} />
            <Layers3 className="h-5 w-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{group.name}</p>
              {group.description && (
                <p className="truncate text-xs text-muted-foreground">
                  {group.description}
                </p>
              )}
            </div>
            <Badge variant="secondary">
              {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
            </Badge>
          </label>
        );
      })}
    </div>
  );
}
