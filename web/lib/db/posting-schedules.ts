import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";
import { nextSlots } from "@/lib/db/schedule-utils";

export type PostingScheduleRow =
  Database["public"]["Tables"]["posting_schedules"]["Row"];
export type PostingScheduleInsert =
  Database["public"]["Tables"]["posting_schedules"]["Insert"];

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

export async function createScheduleSlot(
  values: PostingScheduleInsert
): Promise<PostingScheduleRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posting_schedules")
    .insert(values)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteScheduleSlot(
  id: string,
  workspaceId: string
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("posting_schedules")
    .delete()
    .eq("id", id)
    .eq("workspace_id", workspaceId); // RLS guard
  if (error) throw error;
}

export async function getNextSlotsForWorkspace(
  workspaceId: string,
  platform: "linkedin" | "x",
  count: number = 5
): Promise<Date[]> {
  const schedules = await getScheduleSlotsForWorkspace(workspaceId, platform);
  return nextSlots(schedules, count);
}
