import { createClient } from "@/lib/supabase/server";

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

