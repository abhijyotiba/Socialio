import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrphanedMediaAssets, deleteMediaAssetsByIds } from "@/lib/db/media-assets";
import { deleteFromCloudinary } from "@/lib/adapters/cloudinary";

function verifyCronAuth(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const orphans = await getOrphanedMediaAssets(admin);

  if (orphans.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  // Delete from Cloudinary first — if this partially fails, the DB rows remain
  // and the next run will retry them (cloudinary_id is idempotent to delete).
  const results = await Promise.allSettled(
    orphans.map((o) => deleteFromCloudinary(o.cloudinary_id))
  );

  const deletedIds = orphans
    .filter((_, i) => results[i].status === "fulfilled")
    .map((o) => o.id);

  const failedCount = results.filter((r) => r.status === "rejected").length;

  if (failedCount > 0) {
    console.error(
      `cleanup-orphaned-media: ${failedCount} Cloudinary deletes failed — DB rows retained for retry`
    );
  }

  // Only delete DB rows for assets successfully removed from Cloudinary
  await deleteMediaAssetsByIds(admin, deletedIds);

  return NextResponse.json({
    deleted: deletedIds.length,
    failed: failedCount,
  });
}
