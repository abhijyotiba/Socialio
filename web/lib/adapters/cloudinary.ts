import crypto from "crypto";
import { z } from "zod";

const UploadResponseSchema = z.object({
  public_id: z.string(),
  secure_url: z.string(),
  resource_type: z.string(),
  format: z.string(),
  bytes: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export type CloudinaryUploadResult = z.infer<typeof UploadResponseSchema>;

function buildSignature(params: Record<string, string>, apiSecret: string): string {
  const sorted = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return crypto.createHash("sha256").update(sorted + apiSecret).digest("hex");
}

// Uploads a file buffer to Cloudinary using signed server-side upload.
// folder: Cloudinary folder name (e.g. "user-uploads/<workspace_id>")
export async function uploadToCloudinary(
  fileBuffer: Buffer,
  mimeType: string,
  folder: string
): Promise<CloudinaryUploadResult> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
  const apiKey = process.env.CLOUDINARY_API_KEY!;
  const apiSecret = process.env.CLOUDINARY_API_SECRET!;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    folder,
    resource_type: "image",
    timestamp,
  };
  const signature = buildSignature(params, apiSecret);

  const form = new FormData();
  form.append("file", new Blob([fileBuffer], { type: mimeType }));
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("folder", folder);
  form.append("resource_type", "image");
  form.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: "POST", body: form }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Cloudinary upload failed: ${response.status} ${text}`);
  }

  return UploadResponseSchema.parse(await response.json());
}
