import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";
import { nextSlots } from "@/lib/db/schedule-utils";

export type PostingScheduleRow =
  Database["public"]["Tables"]["posting_schedules"]["Row"];

export async function getScheduleSlotsForWorkspace(
  workspaceId: string,
  platform: "linkedin" | "x"
): Promise<PostingScheduleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posting_schedules")
    .select()
    .eq("workspace_id", workspaceId)
    .eq("platform", platform)
    .order("hour", { ascending: true })
    .order("minute", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getNextSlotsForWorkspace(
  workspaceId: string,
  platform: "linkedin" | "x",
  count: number = 5
): Promise<Date[]> {
  const schedules = await getScheduleSlotsForWorkspace(workspaceId, platform);
  return nextSlots(schedules, count);
}

