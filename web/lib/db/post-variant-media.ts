import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type Row = Database["public"]["Tables"]["post_variant_media"]["Row"];

export type MediaSelection = {
  media_asset_id: string;
  position: number;
  cloudinary_url: string;
  resource_type: string;
  width: number | null;
  height: number | null;
  format: string | null;
};

// Returns the ordered media selection for a variant, joined with asset details.
export async function getVariantMedia(
  postVariantId: string
): Promise<MediaSelection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variant_media")
    .select(
      "media_asset_id, position, media_assets(cloudinary_url, resource_type, width, height, format)"
    )
    .eq("post_variant_id", postVariantId)
    .order("position");
  if (error || !data) return [];
  return data.map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join shape
    const asset = (row as any).media_assets;
    return {
      media_asset_id: row.media_asset_id,
      position: row.position,
      cloudinary_url: asset?.cloudinary_url ?? "",
      resource_type: asset?.resource_type ?? "image",
      width: asset?.width ?? null,
      height: asset?.height ?? null,
      format: asset?.format ?? null,
    };
  });
}

// Replaces the full media selection for a variant.
// Upserts new rows first (so old data is never deleted before new rows land),
// then removes any rows not in the new set. Max 4 assets.
export async function setVariantMedia(
  postVariantId: string,
  mediaAssetIds: string[]
): Promise<void> {
  if (mediaAssetIds.length > 4) {
    throw new Error("Maximum 4 media attachments per post variant");
  }
  const supabase = await createClient();

  if (mediaAssetIds.length > 0) {
    const rows: Database["public"]["Tables"]["post_variant_media"]["Insert"][] =
      mediaAssetIds.map((id, index) => ({
        post_variant_id: postVariantId,
        media_asset_id: id,
        position: index,
      }));

    // Upsert first — if this fails, existing rows are still intact (no data loss).
    const { error: upsertError } = await supabase
      .from("post_variant_media")
      .upsert(rows, { onConflict: "post_variant_id,media_asset_id" });
    if (upsertError) throw upsertError;
  }

  // Remove rows whose asset IDs are no longer in the selection.
  let deleteQuery = supabase
    .from("post_variant_media")
    .delete()
    .eq("post_variant_id", postVariantId);

  if (mediaAssetIds.length > 0) {
    deleteQuery = deleteQuery.not(
      "media_asset_id",
      "in",
      `(${mediaAssetIds.join(",")})`
    );
  }

  const { error: deleteError } = await deleteQuery;
  if (deleteError) throw deleteError;
}

// Returns just the raw rows — used by publish engine (no join needed, just cloudinary_url).
export async function getVariantMediaRaw(
  postVariantId: string
): Promise<Row[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variant_media")
    .select("*")
    .eq("post_variant_id", postVariantId)
    .order("position");
  if (error || !data) return [];
  return data;
}
