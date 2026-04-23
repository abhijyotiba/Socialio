import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSecret } from "@/lib/security/vault";
import { getSocialConnection } from "@/lib/db/social-connections";
import {
  createPublishAttempt,
  updatePublishAttempt,
  hasSuccessfulAttempt,
} from "@/lib/db/publish-attempts";
import { updatePostVariant } from "@/lib/db/posts";
import { publishLinkedInPost } from "@/lib/adapters/linkedin";
import { publishTweet } from "@/lib/adapters/x";
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
  if (await hasSuccessfulAttempt(idempotencyKey)) {
    await updatePostVariant(variant.id, { status: "published" });
    return { succeeded: true };
  }

  const platform = variant.platform as "linkedin" | "x";
  const connection = await getSocialConnection(variant.workspace_id, platform);
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
  });

  try {
    let result: { platformPostId: string; platformPostUrl: string };

    if (platform === "linkedin") {
      const authorUrn = `urn:li:person:${connection.platform_user_id}`;
      result = await publishLinkedInPost(
        accessToken,
        authorUrn,
        variant.body,
        idempotencyKey
      );
    } else {
      result = await publishTweet(accessToken, variant.body);
    }

    await updatePublishAttempt(attempt.id, {
      status: "success",
      platform_post_id: result.platformPostId,
      platform_post_url: result.platformPostUrl,
      completed_at: new Date().toISOString(),
    });

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
    });

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
