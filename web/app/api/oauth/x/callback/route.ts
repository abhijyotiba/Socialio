import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCodeForTokens, getUserInfo } from "@/lib/adapters/x";
import { createSecret } from "@/lib/security/vault";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { upsertSocialConnection } from "@/lib/db/social-connections";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);

  // X sends ?error=access_denied&error_description=... when the user denies or
  // the app config is wrong. Redirect back to settings with a readable message.
  const xError = searchParams.get("error");
  if (xError) {
    const desc = searchParams.get("error_description") ?? xError;
    return NextResponse.redirect(
      new URL(
        `/settings/connections?x_error=${encodeURIComponent(desc)}`,
        request.url
      )
    );
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/settings/connections?x_error=missing_code", request.url)
    );
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get("x_oauth_state")?.value;
  const codeVerifier = cookieStore.get("x_code_verifier")?.value;

  if (!savedState || savedState !== state || !codeVerifier) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  cookieStore.delete("x_oauth_state");
  cookieStore.delete("x_code_verifier");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }
  const workspaceId = workspace.workspace_id;

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, codeVerifier);
  } catch {
    return NextResponse.json(
      { error: "X token exchange failed" },
      { status: 502 }
    );
  }

  const admin = createAdminClient();
  const accessVaultId = await createSecret(
    admin,
    tokens.access_token,
    `x:access:${workspaceId}`
  );

  let refreshVaultId: string | null = null;
  if (tokens.refresh_token) {
    refreshVaultId = await createSecret(
      admin,
      tokens.refresh_token,
      `x:refresh:${workspaceId}`
    );
  }

  let platformUserId: string | null = null;
  let platformUsername: string | null = null;
  try {
    const info = await getUserInfo(tokens.access_token);
    platformUserId = info.data.id;
    platformUsername = info.data.username;
  } catch {
    // Profile fetch failure is non-fatal; connection is still stored.
  }

  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  // If X did not return a refresh token, the access token expires in ~2h.
  // Flag needs_reauth so the UI can prompt the user to reconnect before posting.
  const needsReauth = !tokens.refresh_token;

  await upsertSocialConnection(
    {
      workspace_id: workspaceId,
      platform: "x",
      platform_user_id: platformUserId,
      platform_username: platformUsername,
      access_token_vault_id: accessVaultId,
      refresh_token_vault_id: refreshVaultId,
      token_expires_at: tokenExpiresAt,
      needs_reauth: needsReauth,
    },
    admin
  );

  return NextResponse.redirect(
    new URL("/settings/connections?x=connected", request.url)
  );
}
