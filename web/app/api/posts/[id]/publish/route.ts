import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant, updatePostVariant } from "@/lib/db/posts";
import {
  createPublishAttempt,
  updatePublishAttempt,
  hasSuccessfulAttempt,
  getLatestAttempt,
} from "@/lib/db/publish-attempts";
import { getSocialConnectionForPersona } from "@/lib/db/social-connections";
// Legacy fallback for pre-persona variants that still carry NULL persona_id.
// eslint-disable-next-line no-restricted-imports -- intentional fallback for legacy variants; remove once all variants are persona-scoped
import { getSocialConnection } from "@/lib/db/_legacy/social-connections";
import { readSecret } from "@/lib/security/vault";
import { publishLinkedInPost } from "@/lib/adapters/linkedin";
import { publishTweet } from "@/lib/adapters/x";
import { getVariantMedia } from "@/lib/db/post-variant-media";
import { uploadMediaForPlatform } from "@/lib/publish/upload-media";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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
  const workspaceId = workspace.workspace_id;

  const { id } = await params;
  const variant = await getPostVariant(id);
  if (!variant) {
    return NextResponse.json({ error: "Post variant not found" }, { status: 404 });
  }
  if (variant.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!["draft", "failed"].includes(variant.status)) {
    return NextResponse.json(
      { error: `Cannot publish a variant with status '${variant.status}'` },
      { status: 409 }
    );
  }

  // Idempotency guard — never double-publish a successfully published variant
  const idempotencyKey = variant.id;
  if (await hasSuccessfulAttempt(idempotencyKey)) {
    return NextResponse.json(
      { error: "This variant has already been published" },
      { status: 409 }
    );
  }

  const platform = variant.platform as "linkedin" | "x";
  // Persona-scoped tokens are the new contract; fall back to workspace-default
  // for pre-persona variants that still carry NULL persona_id.
  const connection = variant.persona_id
    ? await getSocialConnectionForPersona(variant.persona_id, platform)
    : await getSocialConnection(workspaceId, platform);
  if (!connection) {
    return NextResponse.json(
      { error: `No ${variant.platform} account connected` },
      { status: 409 }
    );
  }
  if (connection.needs_reauth) {
    return NextResponse.json(
      { error: `${variant.platform} account needs re-authentication` },
      { status: 409 }
    );
  }

  // Compute next attempt number (supports retries after failure)
  const latestAttempt = await getLatestAttempt(id);
  const attemptNumber = latestAttempt ? latestAttempt.attempt_number + 1 : 1;

  // Claim the variant — prevents duplicate in-flight publishes
  await updatePostVariant(id, { status: "publishing" });

  // Read the access token from Vault — requires admin/service-role client.
  // See DECISIONS.md: publish routes are a permitted exception to the admin-client rule
  // because vault_read_secret is restricted to service_role.
  const admin = createAdminClient();
  const accessToken = await readSecret(admin, connection.access_token_vault_id!);

  const attempt = await createPublishAttempt({
    workspace_id: workspaceId,
    post_variant_id: id,
    idempotency_key: idempotencyKey,
    attempt_number: attemptNumber,
    status: "attempting",
  });

  try {
    let result: { platformPostId: string; platformPostUrl: string };

    // Fetch and upload any attached media assets before publishing
    const mediaAssets = await getVariantMedia(id);
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
    });

    await updatePostVariant(id, {
      status: "published",
      published_at: new Date().toISOString(),
      platform_post_id: result.platformPostId,
      platform_post_url: result.platformPostUrl,
    });

    return NextResponse.json({
      status: "published",
      platform_post_url: result.platformPostUrl,
    });
  } catch (err) {
    const errorCode =
      (err as { errorCode?: string }).errorCode ?? "UNKNOWN";
    const errorDetail =
      err instanceof Error ? err.message : "Unknown error";

    await updatePublishAttempt(attempt.id, {
      status: "failed",
      error_code: errorCode,
      error_detail: errorDetail,
      completed_at: new Date().toISOString(),
    });

    await updatePostVariant(id, {
      status: "failed",
      error: errorDetail,
      error_code: errorCode,
    });

    const httpStatus = errorCode === "TOKEN_EXPIRED" ? 401 : 502;
    return NextResponse.json(
      { error: errorDetail, error_code: errorCode },
      { status: httpStatus }
    );
  }
}
