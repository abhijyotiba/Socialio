import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type MediaAssetRow = Database["public"]["Tables"]["media_assets"]["Row"];

// Ingestion media rows are now written by the Python worker
// (worker/db/media_assets.py). This read is still used by the media route.
export async function getMediaAssetsForJob(
  jobId: string
): Promise<MediaAssetRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media_assets")
    .select("*")
    .eq("ingestion_job_id", jobId);
  if (error) return [];
  return data;
}
