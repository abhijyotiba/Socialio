import {
  registerLinkedInUpload,
  uploadBytesToLinkedIn,
} from "@/lib/adapters/linkedin";
import { uploadMediaToX } from "@/lib/adapters/x";

export function mimeTypeFromUrl(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "jpg":
    case "jpeg":
    default: return "image/jpeg";
  }
}

// Fetches image bytes from a Cloudinary URL.
// Returns null on failure (non-fatal — caller publishes text-only).
async function fetchImageBytes(cloudinaryUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(cloudinaryUrl);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export type MediaForPublish = {
  cloudinary_url: string;
};

// Uploads each media asset to the target platform.
// Returns platform-specific IDs/URNs in the same order as input.
// Failures are non-fatal — logs a warning and returns empty array.
export async function uploadMediaForPlatform(
  platform: "linkedin" | "x",
  accessToken: string,
  assets: MediaForPublish[],
  authorUrn?: string // LinkedIn only
): Promise<string[]> {
  if (assets.length === 0) return [];

  const ids: string[] = [];

  for (const asset of assets) {
    try {
      const mimeType = mimeTypeFromUrl(asset.cloudinary_url);
      const imageBytes = await fetchImageBytes(asset.cloudinary_url);
      if (!imageBytes) {
        console.warn(`[upload-media] Failed to fetch bytes from ${asset.cloudinary_url} — skipping`);
        continue;
      }

      if (platform === "linkedin") {
        if (!authorUrn) throw new Error("authorUrn required for LinkedIn");
        const { uploadUrl, assetUrn } = await registerLinkedInUpload(
          accessToken,
          authorUrn,
          imageBytes.length
        );
        await uploadBytesToLinkedIn(uploadUrl, imageBytes);
        ids.push(assetUrn);
      } else {
        const mediaId = await uploadMediaToX(accessToken, imageBytes, mimeType);
        ids.push(mediaId);
      }
    } catch (err) {
      console.warn(
        `[upload-media] Media upload failed for ${asset.cloudinary_url}:`,
        err instanceof Error ? err.message : err
      );
      // Non-fatal: skip this asset, continue with others
    }
  }

  return ids;
}
