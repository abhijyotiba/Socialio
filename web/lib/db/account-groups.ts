import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type GroupRow = Database["public"]["Tables"]["persona_groups"]["Row"];

export type AccountGroupWithMembers = GroupRow & {
  persona_ids: string[];
};

// Account groups for a workspace, each with its persona membership.
// Group writes are owned by the worker under RLS; these reads back the GET
// route and other consumers. Empty-safe: returns [] when the workspace has no
// groups (or none of its groups have members) so callers can rely on it before
// any groups exist. RLS scopes to the caller's workspace; the explicit eq()
// keeps the filter visible.
export async function getAccountGroupsWithMembers(
  workspaceId: string
): Promise<AccountGroupWithMembers[]> {
  const supabase = await createClient();

  const { data: groups, error: groupsError } = await supabase
    .from("persona_groups")
    .select("id, workspace_id, name, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });
  if (groupsError) throw groupsError;
  if (!groups || groups.length === 0) return [];

  const groupIds = groups.map((g) => g.id);
  const { data: members, error: membersError } = await supabase
    .from("persona_group_members")
    .select("group_id, persona_id")
    .in("group_id", groupIds);
  if (membersError) throw membersError;

  const byGroup = new Map<string, string[]>();
  for (const m of members ?? []) {
    const list = byGroup.get(m.group_id) ?? [];
    list.push(m.persona_id);
    byGroup.set(m.group_id, list);
  }

  return groups.map((g) => ({ ...g, persona_ids: byGroup.get(g.id) ?? [] }));
}
