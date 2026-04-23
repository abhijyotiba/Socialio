import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { readSecret, createSecret } from "@/lib/security/vault";
import { refreshLinkedInToken } from "@/lib/adapters/linkedin";
import { refreshXToken } from "@/lib/adapters/x";
import type { Database } from "@/lib/db/types";

type SocialConnectionRow = Database["public"]["Tables"]["social_connections"]["Row"];

function verifyCronAuth(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

async function refreshConnection(
  connection: SocialConnectionRow,
  admin: ReturnType<typeof createAdminClient>
): Promise<"refreshed" | "flagged"> {
  if (!connection.refresh_token_vault_id) {
    // No refresh token — user must reconnect manually
    await admin
      .from("social_connections")
      .update({ needs_reauth: true })
      .eq("id", connection.id);
    return "flagged";
  }

  try {
    const refreshToken = await readSecret(admin, connection.refresh_token_vault_id);

    let result: { accessToken: string; expiresIn?: number; newRefreshToken?: string };
    if (connection.platform === "linkedin") {
      result = await refreshLinkedInToken(refreshToken);
    } else {
      result = await refreshXToken(refreshToken);
    }

    // Store the new access token in Vault
    const newAccessVaultId = await createSecret(
      admin,
      result.accessToken,
      `${connection.platform}:access:${connection.workspace_id}:${Date.now()}`
    );

    const tokenExpiresAt = result.expiresIn
      ? new Date(Date.now() + result.expiresIn * 1000).toISOString()
      : null;

    const updates: Partial<SocialConnectionRow> = {
      access_token_vault_id: newAccessVaultId,
      token_expires_at: tokenExpiresAt,
      needs_reauth: false,
    };

    // Store new refresh token if the platform rotated it
    if (result.newRefreshToken) {
      const newRefreshVaultId = await createSecret(
        admin,
        result.newRefreshToken,
        `${connection.platform}:refresh:${connection.workspace_id}:${Date.now()}`
      );
      updates.refresh_token_vault_id = newRefreshVaultId;
    }

    await admin
      .from("social_connections")
      .update(updates)
      .eq("id", connection.id);

    return "refreshed";
  } catch {
    // Refresh failed — flag for manual reconnect
    await admin
      .from("social_connections")
      .update({ needs_reauth: true })
      .eq("id", connection.id);
    return "flagged";
  }
}

export async function POST(request: Request) {
  if (!verifyCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find connections expiring within 7 days that haven't been flagged yet
  const cutoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: expiring, error } = await admin
    .from("social_connections")
    .select()
    .lt("token_expires_at", cutoff)
    .eq("needs_reauth", false);

  if (error) {
    console.error("token-expiry-check query failed:", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const connections = (expiring ?? []) as SocialConnectionRow[];

  const results = await Promise.allSettled(
    connections.map((c) => refreshConnection(c, admin))
  );

  let refreshed = 0;
  let flagged = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value === "refreshed") refreshed++;
      else flagged++;
    } else {
      flagged++;
    }
  }

  return NextResponse.json({ checked: connections.length, refreshed, flagged });
}
