import Link from "next/link";
import { getChannelsForOrg } from "./actions";
import { getChannelGroupsForOrg } from "./groups/actions";
import { getAllChannelMeta } from "@/channels/meta";
import { getMemberRole, requireSession } from "@/lib/auth/server";
import { getOrgLimits } from "@/lib/billing/subscription";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate } from "@/lib/format-date";
import { Layers3, SquarePen } from "lucide-react";

export default async function ChannelsPage() {
  const session = await requireSession();
  const orgId = session.session.activeOrganizationId;
  const [channels, groups, role, limits] = await Promise.all([
    getChannelsForOrg(),
    getChannelGroupsForOrg(),
    getMemberRole(),
    orgId ? getOrgLimits(orgId) : Promise.resolve(null),
  ]);
  const handlers = getAllChannelMeta();
  const isAdminOrOwner = role === "owner" || role === "admin";
  const channelLimit = limits?.channels ?? null;
  const limitReached =
    channelLimit !== null && channels.length >= channelLimit;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure your notification output channels.
          </p>
        </div>
        {isAdminOrOwner && (
          <div className="flex gap-2">
            <Link href="/channels/groups/new">
              <Button variant="outline">
                <Layers3 data-icon="inline-start" />
                Add strategy group
              </Button>
            </Link>
            {limitReached ? (
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} />}>
                <Button disabled>Add channel</Button>
              </TooltipTrigger>
              <TooltipContent>
                Channel limit reached ({channels.length}/{channelLimit}).
                Upgrade your plan for more.
              </TooltipContent>
            </Tooltip>
          ) : (
            <Link href="/channels/new">
              <Button>Add channel</Button>
            </Link>
            )}
          </div>
        )}
      </div>

      {channels.length === 0 ? (
        <div className="mt-8 text-center">
          <p className="text-muted-foreground">No channels configured yet.</p>
          {isAdminOrOwner && (
            <Link href="/channels/new">
              <Button variant="outline" className="mt-4">
                Add your first channel
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                {isAdminOrOwner && <TableHead className="w-[50px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.map((channel) => {
                const handler = handlers.find((h) => h.type === channel.type);
                return (
                  <TableRow key={channel.id}>
                    <TableCell className="font-medium">
                      <Link href={`/channels/${channel.id}/edit`} className="hover:underline">
                        {channel.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {handler?.displayName || channel.type}
                    </TableCell>
                    <TableCell>
                      {channel.enabled ? (
                        <Badge className="border-success/20 bg-success-muted text-success hover:bg-success-muted">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {formatDate(channel.createdAt)}
                    </TableCell>
                    {isAdminOrOwner && (
                      <TableCell>
                        <Link href={`/channels/${channel.id}/edit`}>
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
                            <SquarePen className="h-4 w-4" />
                            <span className="sr-only">Edit</span>
                          </Button>
                        </Link>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="mt-10">
        <div>
          <h2 className="text-lg font-semibold">Strategy groups</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reuse channel filters, failover levels, and Always behavior across webhooks.
          </p>
        </div>
        {groups.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No strategy groups configured.
            </p>
          </div>
        ) : (
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Used by</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdminOrOwner && <TableHead className="w-[50px]" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/channels/groups/${group.id}/edit`}
                        className="hover:underline"
                      >
                        {group.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {group.members.map((member) => (
                          <Badge key={member.channelId} variant="secondary">
                            {member.channel.name} · {member.alwaysDeliver ? "Always" : `L${member.level}`}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{group._count.webhooks}</TableCell>
                    <TableCell>
                      {group.enabled ? (
                        <Badge className="border-success/20 bg-success-muted text-success hover:bg-success-muted">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </TableCell>
                    {isAdminOrOwner && (
                      <TableCell>
                        <Link href={`/channels/groups/${group.id}/edit`}>
                          <Button variant="ghost" size="icon-sm" className="text-muted-foreground">
                            <SquarePen className="h-4 w-4" />
                            <span className="sr-only">Edit</span>
                          </Button>
                        </Link>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
