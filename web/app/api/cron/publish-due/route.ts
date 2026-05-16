import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSecret } from "@/lib/security/vault";
import { getSocialConnectionForPersona } from "@/lib/db/social-connections";
// Fallback path for variants whose persona has been deleted. The FK on
// post_variants.persona_id is ON DELETE SET NULL (migration 0014), so a
// deleted persona leaves its variants alive but personaless. Migration
// 0017 backfills any other historical NULLs.
// eslint-disable-next-line no-restricted-imports -- intentional fallback for orphaned variants
import { getSocialConnection } from "@/lib/db/_legacy/social-connections";
import {
  createPublishAttempt,
  updatePublishAttempt,
  hasSuccessfulAttempt,
} from "@/lib/db/publish-attempts";
import { updatePostVariant } from "@/lib/db/posts";
import { publishLinkedInPost } from "@/lib/adapters/linkedin";
import { publishTweet } from "@/lib/adapters/x";
import { uploadMediaForPlatform } from "@/lib/publish/upload-media";
import type { Database } from "@/lib/db/types";

type PostVariantRow = Database["public"]["Tables"]["post_variants"]["Row"];

function verifyCronAuth(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

async function publishVariant(
  variant: PostVariantRow,
  admin: ReturnType<typeof createAdminClient>
): Promise<{ succeeded: boolean }> {
  const idempotencyKey = variant.id;

  // Skip variants that were already successfully published
  if (await hasSuccessfulAttempt(idempotencyKey, admin)) {
    await updatePostVariant(variant.id, { status: "published" });
    return { succeeded: true };
  }

  const platform = variant.platform as "linkedin" | "x";
  const connection = variant.persona_id
    ? await getSocialConnectionForPersona(variant.persona_id, platform)
    : await getSocialConnection(variant.workspace_id, platform);
  if (!connection || connection.needs_reauth || !connection.access_token_vault_id) {
    await updatePostVariant(variant.id, {
      status: "failed",
      error: "No valid connection for platform",
      error_code: "TOKEN_EXPIRED",
    });
    return { succeeded: false };
  }

  const accessToken = await readSecret(admin, connection.access_token_vault_id);

  // Compute next attempt number
  const { data: latestRows } = await admin
    .from("publish_attempts")
    .select("attempt_number")
    .eq("post_variant_id", variant.id)
    .order("attempt_number", { ascending: false })
    .limit(1);
  const attemptNumber = latestRows?.[0]?.attempt_number
    ? latestRows[0].attempt_number + 1
    : 1;

  const attempt = await createPublishAttempt({
    workspace_id: variant.workspace_id,
    post_variant_id: variant.id,
    idempotency_key: idempotencyKey,
    attempt_number: attemptNumber,
    status: "attempting",
  }, admin);

  try {
    let result: { platformPostId: string; platformPostUrl: string };

    // Fetch attached media via admin client (no user JWT in cron context)
    const { data: mediaRows } = await admin
      .from("post_variant_media")
      .select("media_asset_id, position, media_assets(cloudinary_url)")
      .eq("post_variant_id", variant.id)
      .order("position");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join shape
    const mediaAssets = ((mediaRows ?? []) as any[])
      .map((row) => ({ cloudinary_url: row.media_assets?.cloudinary_url ?? "" }))
      .filter((a) => a.cloudinary_url);

    const authorUrn =
      platform === "linkedin"
        ? `urn:li:person:${connection.platform_user_id}`
        : undefined;

    const platformMediaIds = await uploadMediaForPlatform(
      platform,
      accessToken,
      mediaAssets,
      authorUrn
    );

    if (platform === "linkedin") {
      result = await publishLinkedInPost(
        accessToken,
        authorUrn!,
        variant.body,
        idempotencyKey,
        platformMediaIds.length > 0 ? platformMediaIds : undefined
      );
    } else {
      result = await publishTweet(
        accessToken,
        variant.body,
        platformMediaIds.length > 0 ? platformMediaIds : undefined
      );
    }

    await updatePublishAttempt(attempt.id, {
      status: "success",
      platform_post_id: result.platformPostId,
      platform_post_url: result.platformPostUrl,
      completed_at: new Date().toISOString(),
    }, admin);

    await updatePostVariant(variant.id, {
      status: "published",
      published_at: new Date().toISOString(),
      platform_post_id: result.platformPostId,
      platform_post_url: result.platformPostUrl,
    });

    return { succeeded: true };
  } catch (err) {
    const errorCode = (err as { errorCode?: string }).errorCode ?? "UNKNOWN";
    const errorDetail = err instanceof Error ? err.message : "Unknown error";

    await updatePublishAttempt(attempt.id, {
      status: "failed",
      error_code: errorCode,
      error_detail: errorDetail,
      completed_at: new Date().toISOString(),
    }, admin);

    await updatePostVariant(variant.id, {
      status: "failed",
      error: errorDetail,
      error_code: errorCode,
    });

    return { succeeded: false };
  }
}

export async function POST(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const workerId = crypto.randomUUID();

  // Zombie campaign cleanup: campaigns stuck in 'generating' > 3 minutes → failed
  const { data: zombieCampaigns } = await admin
    .from('campaigns')
    .update({
      status: 'failed',
      failure_code: 'GENERATION_TIMEOUT',
      failure_reason: 'Generation exceeded the 3-minute window.',
    })
    .eq('status', 'generating')
    .lt('generation_started_at', new Date(Date.now() - 3 * 60 * 1000).toISOString())
    .select('id, workspace_id')

  if (zombieCampaigns?.length) {
    const zombieIds = zombieCampaigns.map((c: { id: string }) => c.id)
    await admin
      .from('campaign_personas')
      .update({ approval_status: 'rejected' })
      .eq('approval_status', 'pending')
      .in('campaign_id', zombieIds)

    // Emit audit events so the user-facing UI can surface a reason for the
    // failure (campaigns table has no error column today). Best-effort —
    // never block the cron sweep on audit write failures.
    await admin
      .from('audit_events')
      .insert(
        zombieCampaigns.map((c: { id: string; workspace_id: string }) => ({
          workspace_id: c.workspace_id,
          entity_type: 'campaign',
          entity_id: c.id,
          event_type: 'campaign.zombie_timeout',
          metadata: { reason: 'generation_exceeded_3_minutes' },
        }))
      )
      .then(() => {}, () => {})
  }

  // Sweeper: reset rows stuck in 'publishing' for > 10 minutes
  const { data: sweptRows } = await admin
    .from("post_variants")
    .update({ status: "scheduled" })
    .eq("status", "publishing")
    .lt("claimed_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .select("id");
  const swept = sweptRows?.length ?? 0;

  // Claim due variants atomically via FOR UPDATE SKIP LOCKED
  const { data: claimedRows, error: claimError } = await admin.rpc(
    "claim_due_variants",
    { p_worker_id: workerId, p_limit: 10 }
  );

  if (claimError) {
    console.error("claim_due_variants RPC failed:", claimError);
    return NextResponse.json({ error: "Claim failed" }, { status: 500 });
  }

  const claimed = ((claimedRows as unknown) as PostVariantRow[]) ?? [];

  // Publish all claimed variants in parallel
  const results = await Promise.allSettled(
    claimed.map((variant) => publishVariant(variant, admin))
  );

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.succeeded
  ).length;
  const failed = results.length - succeeded;

  return NextResponse.json({
    swept,
    attempted: claimed.length,
    succeeded,
    failed,
  });
}
