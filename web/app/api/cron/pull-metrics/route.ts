import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSecret } from "@/lib/security/vault";
import { getSocialConnectionForPersona } from "@/lib/db/social-connections";
// Legacy fallback for pre-persona variants that still carry NULL persona_id.
// eslint-disable-next-line no-restricted-imports -- intentional fallback for legacy variants; remove once all variants are persona-scoped
import { getSocialConnection } from "@/lib/db/_legacy/social-connections";
import { upsertPostMetrics } from "@/lib/db/metrics";
import { getPostMetrics as getXMetrics } from "@/lib/adapters/x";
import { getPostMetrics as getLinkedInMetrics } from "@/lib/adapters/linkedin";
import type { Database } from "@/lib/db/types";

type PostVariantRow = Database["public"]["Tables"]["post_variants"]["Row"];

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
  let checked = 0;
  let synced = 0;
  let failed = 0;

  // Find posts published in the last 30 days that need metric syncing
  // Limiting to 50 per run
  const { data: variants, error } = await admin
    .from("post_variants")
    .select()
    .eq("status", "published")
    .not("platform_post_id", "is", null)
    .gt("published_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .order("published_at", { ascending: false })
    .limit(50);

  if (error || !variants) {
    return NextResponse.json({ error: "Query failed", db_error: error?.message }, { status: 500 });
  }

  for (const variant of variants) {
    checked++;
    try {
      const platform = variant.platform as "linkedin" | "x";
      const connection = variant.persona_id
        ? await getSocialConnectionForPersona(variant.persona_id, platform)
        : await getSocialConnection(variant.workspace_id, platform);

      if (!connection || connection.needs_reauth || !connection.access_token_vault_id) {
        throw new Error("Missing valid connection");
      }

      const accessToken = await readSecret(admin, connection.access_token_vault_id);
      
      let metricsPayload: { impressions: number; likes: number; comments: number; shares: number } | null = null;
      
      if (platform === "linkedin") {
        const authorUrn = `urn:li:person:${connection.platform_user_id}`;
        metricsPayload = await getLinkedInMetrics(accessToken, authorUrn, variant.platform_post_id!);
      } else {
        metricsPayload = await getXMetrics(accessToken, variant.platform_post_id!);
      }

      await upsertPostMetrics({
        post_variant_id: variant.id,
        workspace_id: variant.workspace_id,
        impressions: metricsPayload.impressions,
        likes: metricsPayload.likes,
        comments: metricsPayload.comments,
        shares: metricsPayload.shares,
        last_synced_at: new Date().toISOString(),
      }, admin);

      synced++;
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "POST_DELETED") {
        // Stop syncing if the user deleted the post directly on the platform
      } else {
        failed++;
      }
    }
  }

  return NextResponse.json({
    checked,
    synced,
    failed,
  });
}
