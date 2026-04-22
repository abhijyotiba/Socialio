import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";
import type { WorkerMediaItem } from "@/lib/worker-client";

type MediaAssetRow = Database["public"]["Tables"]["media_assets"]["Row"];

export async function createMediaAssets(
  workspaceId: string,
  jobId: string,
  items: WorkerMediaItem[]
): Promise<MediaAssetRow[]> {
  if (items.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("media_assets")
    .insert(
      items.map((m) => ({
        workspace_id: workspaceId,
        ingestion_job_id: jobId,
        cloudinary_url: m.cloudinary_url,
        cloudinary_id: m.cloudinary_id,
        resource_type: m.resource_type,
        format: m.format,
        bytes: m.bytes,
        width: m.width,
        height: m.height,
      }))
    )
    .select();
  if (error) throw error;
  return data;
}

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
