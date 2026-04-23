import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getSocialConnection } from "@/lib/db/social-connections";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ linkedin?: string; x?: string; x_error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const workspace = await getWorkspaceForUser(user.id);
  const [linkedIn, xConnection] = workspace
    ? await Promise.all([
        getSocialConnection(workspace.workspace_id, "linkedin"),
        getSocialConnection(workspace.workspace_id, "x"),
      ])
    : [null, null];

  const linkedInJustConnected = params.linkedin === "connected";
  const xJustConnected = params.x === "connected";
  const xError = params.x_error;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 rounded-3xl border border-slate-200/70 bg-white p-6 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">
          Connected accounts
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Manage the social accounts SocialOS can publish to.
        </p>
      </div>

      {linkedInJustConnected && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-700">
            LinkedIn connected successfully.
          </p>
        </div>
      )}

      {xError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">
            X connection failed: <span className="font-mono">{xError}</span>
          </p>
          <p className="mt-1 text-xs text-red-500">
            Check that your X app has <strong>Read and write</strong> permissions, <strong>Web App</strong> type, and <strong>offline.access</strong> scope enabled.
          </p>
        </div>
      )}

      {xJustConnected && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-700">
            X / Twitter connected successfully.
          </p>
        </div>
      )}

      <Card className="rounded-2xl border-slate-200/80 shadow-none">
        <CardHeader>
          <CardTitle>LinkedIn</CardTitle>
          <CardDescription>
            Required to publish posts on LinkedIn.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          {linkedIn && !linkedIn.needs_reauth ? (
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900">
                {linkedIn.platform_username ?? "Connected"}
              </p>
              {linkedIn.token_expires_at && (
                <p className="text-xs text-slate-500">
                  Token expires{" "}
                  {new Date(linkedIn.token_expires_at).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {linkedIn?.needs_reauth
                ? "Re-authentication required."
                : "Not connected."}
            </p>
          )}

          <a
            href="/api/oauth/linkedin/start"
            className="text-sm font-medium text-indigo-600 underline-offset-2 hover:underline"
          >
            {linkedIn ? "Reconnect" : "Connect"}
          </a>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-slate-200/80 shadow-none">
        <CardHeader>
          <CardTitle>X / Twitter</CardTitle>
          <CardDescription>
            Required to publish posts on X. Requires{" "}
            <code className="text-xs">offline.access</code> scope for a long-lived token.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          {xConnection && !xConnection.needs_reauth ? (
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-slate-900">
                @{xConnection.platform_username ?? "Connected"}
              </p>
              {xConnection.token_expires_at && (
                <p className="text-xs text-slate-500">
                  Token expires{" "}
                  {new Date(xConnection.token_expires_at).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {xConnection?.needs_reauth
                ? "Re-authentication required — token will expire shortly."
                : "Not connected."}
            </p>
          )}

          <a
            href="/api/oauth/x/start"
            className="text-sm font-medium text-indigo-600 underline-offset-2 hover:underline"
          >
            {xConnection ? "Reconnect" : "Connect"}
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
