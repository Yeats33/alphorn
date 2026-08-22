import { redirect } from "next/navigation";
import { getMemberRole } from "@/lib/auth/server";
import { getChannelsForOrg } from "../../../actions";
import { getAllTagsForOrg } from "../../../../messages/actions";
import { getChannelGroupById } from "../../actions";
import { StrategyGroupForm } from "../../strategy-group-form";

export default async function EditStrategyGroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [role, group, channels, tags] = await Promise.all([
    getMemberRole(),
    getChannelGroupById(id),
    getChannelsForOrg(),
    getAllTagsForOrg(),
  ]);
  if (!role || !["owner", "admin"].includes(role) || !group) {
    redirect("/channels");
  }

  return (
    <StrategyGroupForm
      group={group}
      channels={channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      }))}
      availableTags={tags}
    />
  );
}
