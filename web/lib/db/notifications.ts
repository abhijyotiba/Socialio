import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

// Unread notifications for a workspace, newest first. Covers every kind
// (publish_failed / needs_reauth / campaign_failed) so the in-app banner can
// surface them all. RLS scopes to the caller's workspace; the explicit eq()
// keeps the filter visible.
export async function getUnreadNotifications(
  workspaceId: string
): Promise<NotificationRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, workspace_id, persona_id, kind, title, body, entity_type, entity_id, read_at, created_at"
    )
    .eq("workspace_id", workspaceId)
    .is("read_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
