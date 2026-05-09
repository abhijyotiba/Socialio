"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCheck, Link2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useSearchParams } from "next/navigation";

interface ConnectionInfo {
  platform: string;
  platform_username: string | null;
  token_expires_at: string | null;
  needs_reauth: boolean;
}

interface PersonaDetail {
  connections: ConnectionInfo[];
}

type Props = { personaId: string };

export function ConnectionsForm({ personaId }: Props) {
  const searchParams = useSearchParams();
  const [linkedin, setLinkedin] = useState<ConnectionInfo | null>(null);
  const [xConn, setXConn] = useState<ConnectionInfo | null>(null);
  const [fetching, setFetching] = useState(true);

  const linkedInJustConnected = searchParams.get("linkedin") === "connected";
  const xJustConnected = searchParams.get("x") === "connected";
  const xError = searchParams.get("x_error");

  useEffect(() => {
    fetch(`/api/personas/${personaId}`)
      .then((r) => r.json())
      .then((data: PersonaDetail) => {
        const conns = data.connections ?? [];
        setLinkedin(conns.find((c) => c.platform === "linkedin") ?? null);
        setXConn(conns.find((c) => c.platform === "x") ?? null);
      })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [personaId]);

  const linkedInActive = Boolean(linkedin && !linkedin.needs_reauth);
  const xActive = Boolean(xConn && !xConn.needs_reauth);

  if (fetching) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-20 rounded-2xl" />
        <div className="skeleton h-20 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
          <Link2 className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Connected Accounts</h1>
          <p className="text-xs text-slate-400">
            Manage the social accounts this persona can publish to.
          </p>
        </div>
      </div>

      {/* Toast banners */}
      {linkedInJustConnected && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 animate-message-in">
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-500" />
          <p className="text-sm font-medium text-emerald-700">LinkedIn connected successfully.</p>
        </div>
      )}
      {xJustConnected && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 animate-message-in">
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-500" />
          <p className="text-sm font-medium text-emerald-700">X / Twitter connected successfully.</p>
        </div>
      )}
      {xError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            <p className="text-sm font-medium text-red-700">
              X connection failed: <span className="font-mono text-xs">{xError}</span>
            </p>
          </div>
          <p className="mt-1.5 pl-6 text-xs text-red-500">
            Ensure your X app has <strong>Read and write</strong> permissions,{" "}
            <strong>Web App</strong> type, and <strong>offline.access</strong> scope.
          </p>
        </div>
      )}

      {/* LinkedIn card */}
      <div className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0077b5] shadow-sm">
              <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-slate-900">LinkedIn</p>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    linkedInActive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
                  }`}
                >
                  {linkedInActive ? (
                    <><Wifi className="h-2.5 w-2.5" /> Active</>
                  ) : (
                    <><WifiOff className="h-2.5 w-2.5" /> Not connected</>
                  )}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {linkedInActive
                  ? linkedin?.platform_username
                    ? `@${linkedin.platform_username}`
                    : "Connected account"
                  : linkedin?.needs_reauth
                    ? "Token expired — reconnect to continue publishing"
                    : "Connect to publish posts to LinkedIn"}
              </p>
              {linkedInActive && linkedin?.token_expires_at && (
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Token expires {new Date(linkedin.token_expires_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          <a
            href={`/api/oauth/linkedin/start?persona_id=${personaId}`}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {linkedin ? "Reconnect" : "Connect"}
          </a>
        </div>
      </div>

      {/* X / Twitter card */}
      <div className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-900 shadow-sm">
              <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-slate-900">X / Twitter</p>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    xActive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
                  }`}
                >
                  {xActive ? (
                    <><Wifi className="h-2.5 w-2.5" /> Active</>
                  ) : (
                    <><WifiOff className="h-2.5 w-2.5" /> Not connected</>
                  )}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {xActive
                  ? xConn?.platform_username
                    ? `@${xConn.platform_username}`
                    : "Connected account"
                  : xConn?.needs_reauth
                    ? "Token expired or revoked — reconnect to continue publishing"
                    : "Connect to publish posts to X / Twitter"}
              </p>
              {xActive && xConn?.token_expires_at && (
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Token expires {new Date(xConn.token_expires_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          <a
            href={`/api/oauth/x/start?persona_id=${personaId}`}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-semibold shadow-sm transition ${
              xActive
                ? "border border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
                : "bg-indigo-600 text-white hover:bg-indigo-700"
            }`}
          >
            {xActive ? <RefreshCw className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
            {xConn ? "Reconnect" : "Connect"}
          </a>
        </div>

        <p className="mt-4 text-[11px] text-slate-400 border-t border-slate-100 pt-3">
          Requires <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">offline.access</code> scope for long-lived tokens.
        </p>
      </div>
    </div>
  );
}
