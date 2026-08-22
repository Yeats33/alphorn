import { redirect } from "next/navigation";
import { getMemberRole } from "@/lib/auth/server";
import { getChannelsForOrg } from "../../actions";
import { getAllTagsForOrg } from "../../../messages/actions";
import { StrategyGroupForm } from "../strategy-group-form";

export default async function NewStrategyGroupPage() {
  const role = await getMemberRole();
  if (!role || !["owner", "admin"].includes(role)) redirect("/channels");

  const [channels, tags] = await Promise.all([
    getChannelsForOrg(),
    getAllTagsForOrg(),
  ]);

  return (
    <StrategyGroupForm
      channels={channels.map((channel) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
      }))}
      availableTags={tags}
    />
  );
}
