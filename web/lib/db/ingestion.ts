import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type IngestionJobRow = Database["public"]["Tables"]["ingestion_jobs"]["Row"];
type IngestionJobInsert =
  Database["public"]["Tables"]["ingestion_jobs"]["Insert"];

export async function createIngestionJob(
  values: IngestionJobInsert
): Promise<IngestionJobRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingestion_jobs")
    .insert(values)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateIngestionJob(
  id: string,
  patch: Partial<IngestionJobRow>
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingestion_jobs")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function getIngestionJob(
  id: string
): Promise<IngestionJobRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingestion_jobs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function countRecentJobs(
  workspaceId: string,
  windowSeconds: number
): Promise<number> {
  const supabase = await createClient();
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { count, error } = await supabase
    .from("ingestion_jobs")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", since);
  if (error) return 0;
  return count ?? 0;
}
