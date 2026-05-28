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


// Returns media_assets that have no linked post_variant_media row and were
// created more than `olderThanMinutes` ago (grace period for slow saves).
// Uses admin client because this runs in cron context (no user JWT).
// Two-step: fetch candidate IDs, fetch linked IDs, return the difference.
export async function getOrphanedMediaAssets(
  adminClient: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
  olderThanMinutes = 60
): Promise<Pick<MediaAssetRow, "id" | "cloudinary_id">[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();

  // Step 1: user-uploaded assets older than the grace period
  const { data: candidates, error: e1 } = await adminClient
    .from("media_assets")
    .select("id, cloudinary_id")
    .lt("created_at", cutoff)
    .is("ingestion_job_id", null); // only user-uploaded; ingestion assets are never orphaned
  if (e1) throw e1;
  if (!candidates || candidates.length === 0) return [];

  const candidateIds = candidates.map((c) => c.id);

  // Step 2: which of those are already linked to a post?
  const { data: linked, error: e2 } = await adminClient
    .from("post_variant_media")
    .select("media_asset_id")
    .in("media_asset_id", candidateIds);
  if (e2) throw e2;

  const linkedSet = new Set((linked ?? []).map((r) => r.media_asset_id));
  return candidates.filter((c) => !linkedSet.has(c.id));
}

export async function deleteMediaAssetsByIds(
  adminClient: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await adminClient
    .from("media_assets")
    .delete()
    .in("id", ids);
  if (error) throw error;
}
