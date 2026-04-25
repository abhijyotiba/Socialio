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
import { AlertCircle, ArrowUpRight, Check, Link2, RefreshCw } from "lucide-react";

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

  const linkedInActive = Boolean(linkedIn && !linkedIn.needs_reauth);
  const xActive = Boolean(xConnection && !xConnection.needs_reauth);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 rounded-3xl border border-slate-200/70 bg-white/85 p-6 shadow-[0_18px_44px_-28px_rgba(15,23,42,0.45)] backdrop-blur-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900 md:text-4xl">
          Connected accounts
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Manage the social accounts SocialOS can publish to.
        </p>
      </div>

      {linkedInJustConnected && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-medium text-emerald-700">
            LinkedIn connected successfully.
          </p>
        </div>
      )}

      {xError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-700">
            X connection failed: <span className="font-mono">{xError}</span>
          </p>
          <p className="mt-1 text-xs text-red-500">
            Check that your X app has <strong>Read and write</strong> permissions, <strong>Web App</strong> type, and <strong>offline.access</strong> scope enabled.
          </p>
        </div>
      )}

      {xJustConnected && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <p className="text-sm font-medium text-emerald-700">
            X / Twitter connected successfully.
          </p>
        </div>
      )}

      <Card className="overflow-hidden rounded-3xl border-slate-200/80 shadow-none">
        <CardHeader className="border-b border-slate-100 pb-5">
          <CardTitle className="text-xl font-bold">LinkedIn</CardTitle>
          <CardDescription>
            Configure your LinkedIn connection settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8">
          <div className="flex flex-col gap-4 rounded-2xl border border-dashed p-5 md:flex-row md:items-center md:justify-between bg-[#f4f9ff] border-[#cfe8fb]">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0077b5] text-white shadow-lg shadow-sky-100">
                <span className="text-2xl font-black leading-none">in</span>
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900">
                  {linkedInActive
                    ? linkedIn?.platform_username ?? "Connected account"
                    : "Not Connected"}
                </p>
                <p className="text-sm text-slate-500">
                  {linkedInActive
                    ? "LinkedIn Company Page • Connected successfully"
                    : linkedIn?.needs_reauth
                      ? "Connection expired or re-authentication required"
                      : "Connect LinkedIn to publish your posts"}
                </p>
                {linkedInActive && linkedIn?.token_expires_at ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Token expires {new Date(linkedIn.token_expires_at).toLocaleDateString()}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-3 self-start md:self-auto">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                  linkedInActive
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-700"
                }`}
              >
                {linkedInActive ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {linkedInActive ? "Active" : "Expired"}
              </span>
              <a
                href="/api/oauth/linkedin/start"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-indigo-200 hover:text-indigo-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {linkedIn ? "Reconnect" : "Connect"}
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-3xl border-slate-200/80 shadow-none">
        <CardHeader className="border-b border-slate-100 pb-5">
          <CardTitle className="text-xl font-bold">X / Twitter</CardTitle>
          <CardDescription>
            Configure your X / Twitter connection settings.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8">
          <div
            className={`flex flex-col gap-4 rounded-2xl border border-dashed p-5 md:flex-row md:items-center md:justify-between ${
              xActive ? "border-slate-200 bg-slate-50/60" : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className={`flex items-center gap-4 ${xActive ? "" : "opacity-80"}`}>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black text-white shadow-lg shadow-slate-200">
                <span className="text-2xl font-black leading-none">X</span>
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900">
                  {xActive
                    ? `@${xConnection?.platform_username ?? "connected"}`
                    : "Not Connected"}
                </p>
                <p className="text-sm text-slate-500">
                  {xActive
                    ? "X Account • Connected successfully"
                    : xConnection?.needs_reauth
                      ? "Connection expired or revoked"
                      : "Connect X to publish your posts"}
                </p>
                {xActive && xConnection?.token_expires_at ? (
                  <p className="mt-1 text-xs text-slate-400">
                    Token expires {new Date(xConnection.token_expires_at).toLocaleDateString()}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-3 self-start md:self-auto">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                  xActive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                }`}
              >
                {xActive ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                {xActive ? "Active" : "Expired"}
              </span>

              <a
                href="/api/oauth/x/start"
                className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
                  xActive
                    ? "border border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:text-indigo-700"
                    : "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-[0_12px_28px_-18px_rgba(79,70,229,0.85)] hover:opacity-95"
                }`}
              >
                {xActive ? <RefreshCw className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                {xConnection ? "Reconnect" : "Connect Now"}
                {!xActive ? <ArrowUpRight className="h-3.5 w-3.5" /> : null}
              </a>
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            Requires <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">offline.access</span> scope for long-lived tokens.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
