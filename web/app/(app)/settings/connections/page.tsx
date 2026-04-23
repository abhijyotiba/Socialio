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
  searchParams: Promise<{ linkedin?: string; x?: string }>;
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

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Connected accounts
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Manage the social accounts SocialOS can publish to.
        </p>
      </div>

      {linkedInJustConnected && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3">
          <p className="text-sm text-green-700 dark:text-green-400">
            LinkedIn connected successfully.
          </p>
        </div>
      )}

      {xJustConnected && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3">
          <p className="text-sm text-green-700 dark:text-green-400">
            X / Twitter connected successfully.
          </p>
        </div>
      )}

      {/* LinkedIn */}
      <Card>
        <CardHeader>
          <CardTitle>LinkedIn</CardTitle>
          <CardDescription>
            Required to publish posts on LinkedIn.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          {linkedIn && !linkedIn.needs_reauth ? (
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {linkedIn.platform_username ?? "Connected"}
              </p>
              {linkedIn.token_expires_at && (
                <p className="text-xs text-zinc-400">
                  Token expires{" "}
                  {new Date(linkedIn.token_expires_at).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {linkedIn?.needs_reauth
                ? "Re-authentication required."
                : "Not connected."}
            </p>
          )}

          <a
            href="/api/oauth/linkedin/start"
            className="text-sm underline underline-offset-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            {linkedIn ? "Reconnect" : "Connect"}
          </a>
        </CardContent>
      </Card>

      {/* X / Twitter */}
      <Card>
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
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                @{xConnection.platform_username ?? "Connected"}
              </p>
              {xConnection.token_expires_at && (
                <p className="text-xs text-zinc-400">
                  Token expires{" "}
                  {new Date(xConnection.token_expires_at).toLocaleDateString()}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {xConnection?.needs_reauth
                ? "Re-authentication required — token will expire shortly."
                : "Not connected."}
            </p>
          )}

          <a
            href="/api/oauth/x/start"
            className="text-sm underline underline-offset-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-50"
          >
            {xConnection ? "Reconnect" : "Connect"}
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
