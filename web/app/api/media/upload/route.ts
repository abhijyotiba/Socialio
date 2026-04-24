import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { uploadToCloudinary } from "@/lib/adapters/cloudinary";
import { createUserUploadMediaAsset } from "@/lib/db/media-assets";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing 'file' field" },
      { status: 400 }
    );
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error: `Unsupported file type '${file.type}'. Allowed: jpeg, png, webp, gif`,
      },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File exceeds 10 MB limit" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const folder = `user-uploads/${workspace.workspace_id}`;

  let cloudinaryResult;
  try {
    cloudinaryResult = await uploadToCloudinary(buffer, file.type, folder);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Persist as a media_asset row (no ingestion_job_id — user upload)
  let asset;
  try {
    asset = await createUserUploadMediaAsset({
      workspace_id: workspace.workspace_id,
      cloudinary_url: cloudinaryResult.secure_url,
      cloudinary_id: cloudinaryResult.public_id,
      format: cloudinaryResult.format,
      bytes: cloudinaryResult.bytes,
      width: cloudinaryResult.width ?? null,
      height: cloudinaryResult.height ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to save asset record" },
      { status: 500 }
    );
  }

  return NextResponse.json({ asset }, { status: 201 });
}
