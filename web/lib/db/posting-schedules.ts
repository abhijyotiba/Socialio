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
  values: Omit<PostingScheduleInsert, "persona_id"> & { persona_id?: string }
): Promise<PostingScheduleRow> {
  const supabase = await createClient();
  let personaId = values.persona_id;
  if (!personaId) {
    const { data: persona } = await supabase
      .from("personas")
      .select("id")
      .eq("workspace_id", values.workspace_id)
      .eq("is_default", true)
      .single();
    if (!persona) throw new Error("No default persona found for workspace");
    personaId = persona.id;
  }
  const { data, error } = await supabase
    .from("posting_schedules")
    .insert({ ...values, persona_id: personaId })
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
