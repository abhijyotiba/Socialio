"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import {
  Loader2, Mail, Calendar, Building2, Globe, Tag, Zap,
  CheckCheck, Edit2, LogOut, ExternalLink, Wifi, WifiOff,
  RefreshCw, ArrowRight, ShieldCheck, Sparkles,
} from "lucide-react";
import { SkeletonProfile } from "@/components/app/SkeletonDashboard";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";

type ProfileData = {
  user: { id: string; email: string; created_at: string };
  workspace: { id: string; name: string | null; role: string; created_at: string | null } | null;
  brand: { brand_name: string; industry: string | null; website_url: string | null; tone_tags: string[] } | null;
  connections: {
    linkedin: { connected: boolean; username: string | null; expires_at: string | null } | null;
    x: { connected: boolean; username: string | null; expires_at: string | null } | null;
  };
  stats: { published: number; scheduled: number; drafts: number };
};

function getInitials(email: string) {
  const name = email.split("@")[0] ?? "";
  const parts = name.replace(/[._-]/g, " ").split(" ").filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getDisplayName(email: string) {
  return email.split("@")[0]?.replace(/[._-]/g, " ") ?? "";
}

export default function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const router = useRouter();

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d: ProfileData) => {
        setData(d);
        setDisplayName(getDisplayName(d.user.email));
        setLoading(false);
      })
      .catch(() => { setError("Failed to load profile."); setLoading(false); });
  }, []);

  async function handleSaveName() {
    if (!displayName.trim()) return;
    setSavingName(true);
    setNameError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName.trim() }),
      });
      if (!res.ok) { const d = await res.json(); setNameError(d.error ?? "Save failed"); return; }
      setNameSuccess(true);
      setEditingName(false);
      setTimeout(() => setNameSuccess(false), 3000);
    } catch { setNameError("Network error"); }
    finally { setSavingName(false); }
  }

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (loading) {
    return <SkeletonProfile />;
  }
  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-500">{error ?? "Something went wrong."}</p>
        <button onClick={() => window.location.reload()} className="text-sm font-medium text-indigo-600 underline">Retry</button>
      </div>
    );
  }

  const { user, workspace, brand, connections, stats } = data;
  const initials = getInitials(user.email);
  const memberSince = user.created_at ? format(new Date(user.created_at), "MMM d, yyyy") : "—";
  const memberAge = user.created_at ? formatDistanceToNow(new Date(user.created_at)) : "";
  const linkedinActive = connections.linkedin?.connected ?? false;
  const xActive = connections.x?.connected ?? false;
  const connectedCount = [linkedinActive, xActive].filter(Boolean).length;
  const totalPosts = stats.published + stats.scheduled + stats.drafts;

  return (
    <div className="mx-auto w-full max-w-3xl pb-12 page-enter">

      {/* ── Hero banner ─────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-700 p-6 shadow-xl shadow-indigo-200/40">
        {/* Background decoration */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-8 -left-8 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute right-24 top-8 h-32 w-32 rounded-full bg-violet-500/20" />

        <div className="relative flex items-start justify-between gap-6">
          <div className="flex items-start gap-5">
            {/* Avatar */}
            <div className="relative shrink-0">
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/15 text-2xl font-black text-white shadow-lg backdrop-blur-sm ring-2 ring-white/20">
                {initials}
              </div>
              {/* Online dot */}
              <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400 ring-2 ring-indigo-600 shadow-sm">
                <Zap className="h-3 w-3 text-white" fill="currentColor" />
              </div>
            </div>

            <div className="pt-1">
              {/* Name */}
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveName();
                      if (e.key === "Escape") setEditingName(false);
                    }}
                    className="h-9 rounded-lg border border-white/30 bg-white/10 px-3 text-sm font-bold text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/40 backdrop-blur-sm"
                  />
                  <button onClick={handleSaveName} disabled={savingName}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/20 px-3 text-xs font-bold text-white backdrop-blur-sm transition hover:bg-white/30 disabled:opacity-50">
                    {savingName ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                    Save
                  </button>
                  <button onClick={() => setEditingName(false)}
                    className="text-xs font-medium text-white/60 transition hover:text-white/90">Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-xl font-bold capitalize text-white">
                    {displayName || getDisplayName(user.email)}
                  </h1>
                  <button onClick={() => setEditingName(true)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-white/50 transition hover:bg-white/10 hover:text-white">
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {nameError && <p className="mt-1 text-xs text-red-300">{nameError}</p>}
              {nameSuccess && (
                <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-300">
                  <CheckCheck className="h-3 w-3" /> Name updated
                </p>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1.5 text-sm text-indigo-200">
                  <Mail className="h-3.5 w-3.5" />
                  {user.email}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-100 backdrop-blur-sm">
                  <Calendar className="h-3 w-3" />
                  Joined {memberSince}
                </span>
                {workspace?.role && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-100 backdrop-blur-sm">
                    <ShieldCheck className="h-3 w-3" />
                    {workspace.role}
                  </span>
                )}
                {brand?.brand_name && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-indigo-100 backdrop-blur-sm">
                    <Sparkles className="h-3 w-3" />
                    {brand.brand_name}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Quick sign-out */}
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-xs font-bold text-white/80 backdrop-blur-sm transition hover:bg-white/20 hover:text-white disabled:opacity-50 shrink-0"
          >
            {signingOut ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            Sign out
          </button>
        </div>

        {/* Stat row inside hero */}
        <div className="relative mt-6 grid grid-cols-3 gap-3">
          {[
            { label: "Posts Published", value: stats.published, icon: "🚀" },
            { label: "In Queue", value: stats.scheduled, icon: "📅" },
            { label: "Drafts", value: stats.drafts, icon: "📝" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm text-center">
              <p className="text-2xl font-black text-white">{s.value}</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-indigo-200/80">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Two-column body ─────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">

        {/* Left col — 3/5 */}
        <div className="space-y-4 lg:col-span-3">

          {/* Brand identity */}
          {brand && (
            <div className="card-lift rounded-2xl border border-slate-200/70 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <h2 className="text-sm font-bold text-slate-900">Brand Identity</h2>
                </div>
                <Link href="/settings/brand"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">
                  Edit <ExternalLink className="h-3 w-3" />
                </Link>
              </div>

              <div className="divide-y divide-slate-50">
                <div className="flex items-center justify-between px-5 py-3">
                  <span className="text-xs text-slate-500">Brand name</span>
                  <span className="text-xs font-bold text-slate-900">{brand.brand_name}</span>
                </div>
                {brand.industry && (
                  <div className="flex items-center justify-between px-5 py-3">
                    <span className="text-xs text-slate-500">Industry</span>
                    <span className="text-xs font-semibold text-slate-700">{brand.industry}</span>
                  </div>
                )}
                {brand.website_url && (
                  <div className="flex items-center justify-between px-5 py-3">
                    <span className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Globe className="h-3 w-3" /> Website
                    </span>
                    <a href={brand.website_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline">
                      {brand.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                {brand.tone_tags?.length > 0 && (
                  <div className="flex items-start justify-between gap-4 px-5 py-3">
                    <span className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
                      <Tag className="h-3 w-3" /> Tone
                    </span>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {brand.tone_tags.map((t) => (
                        <span key={t} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700 ring-1 ring-indigo-100">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Content activity */}
          <div className="card-lift rounded-2xl border border-slate-200/70 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-50 text-violet-600">
                  <Zap className="h-3.5 w-3.5" />
                </div>
                <h2 className="text-sm font-bold text-slate-900">Content Activity</h2>
              </div>
              <Link href="/queue"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600">
                View queue <ArrowRight className="h-3 w-3" />
              </Link>
            </div>

            <div className="p-5">
              {/* Activity bar */}
              {totalPosts > 0 ? (
                <div>
                  <div className="flex overflow-hidden rounded-full h-2.5">
                    {stats.published > 0 && (
                      <div className="bg-emerald-400 transition-all" style={{ width: `${(stats.published / totalPosts) * 100}%` }} />
                    )}
                    {stats.scheduled > 0 && (
                      <div className="bg-indigo-400 transition-all" style={{ width: `${(stats.scheduled / totalPosts) * 100}%` }} />
                    )}
                    {stats.drafts > 0 && (
                      <div className="bg-slate-200 transition-all" style={{ width: `${(stats.drafts / totalPosts) * 100}%` }} />
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    {[
                      { label: "Published", value: stats.published, color: "text-emerald-600", bg: "bg-emerald-50", dot: "bg-emerald-400" },
                      { label: "Scheduled", value: stats.scheduled, color: "text-indigo-600", bg: "bg-indigo-50", dot: "bg-indigo-400" },
                      { label: "Drafts", value: stats.drafts, color: "text-slate-600", bg: "bg-slate-50", dot: "bg-slate-300" },
                    ].map((s) => (
                      <div key={s.label} className={`rounded-xl ${s.bg} p-3 text-center`}>
                        <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                        <div className="mt-1 flex items-center justify-center gap-1">
                          <div className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                          <p className="text-[10px] font-semibold text-slate-500">{s.label}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <p className="text-sm font-semibold text-slate-600">No content yet</p>
                  <p className="mt-1 text-xs text-slate-400">Head to the studio to create your first post.</p>
                  <Link href="/chat">
                    <button className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-700">
                      <Zap className="h-3.5 w-3.5" /> Open Studio
                    </button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right col — 2/5 */}
        <div className="space-y-4 lg:col-span-2">

          {/* Workspace */}
          <div className="card-lift rounded-2xl border border-slate-200/70 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                <Building2 className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Workspace</h2>
            </div>
            {workspace ? (
              <div className="divide-y divide-slate-50">
                <div className="flex items-center justify-between px-5 py-3">
                  <span className="text-xs text-slate-500">ID</span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600">
                    {workspace.id.slice(0, 8)}…
                  </span>
                </div>
                <div className="flex items-center justify-between px-5 py-3">
                  <span className="text-xs text-slate-500">Role</span>
                  <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600">
                    {workspace.role}
                  </span>
                </div>
                <div className="flex items-center justify-between px-5 py-3">
                  <span className="text-xs text-slate-500">Member for</span>
                  <span className="text-xs font-semibold text-slate-700">{memberAge}</span>
                </div>
              </div>
            ) : (
              <p className="px-5 py-4 text-xs text-slate-400">No workspace found.</p>
            )}
          </div>

          {/* Connected platforms */}
          <div className="card-lift rounded-2xl border border-slate-200/70 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  <Wifi className="h-3.5 w-3.5" />
                </div>
                <h2 className="text-sm font-bold text-slate-900">Platforms</h2>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                connectedCount === 2 ? "bg-emerald-50 text-emerald-600"
                : connectedCount === 1 ? "bg-amber-50 text-amber-600"
                : "bg-red-50 text-red-500"}`}>
                {connectedCount}/2 active
              </span>
            </div>

            <div className="divide-y divide-slate-50">
              {/* LinkedIn */}
              <div className="flex items-center gap-3 px-5 py-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ${linkedinActive ? "bg-[#0077b5]" : "bg-slate-200"}`}>
                  <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-slate-800">LinkedIn</p>
                    {linkedinActive
                      ? <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600"><Wifi className="h-2.5 w-2.5" /> Active</span>
                      : <span className="flex items-center gap-0.5 text-[10px] font-bold text-slate-400"><WifiOff className="h-2.5 w-2.5" /> Not connected</span>}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {connections.linkedin?.username ? `@${connections.linkedin.username}` : "Connect to publish"}
                  </p>
                </div>
                <a href="/api/oauth/linkedin/start"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:border-[#0077b5] hover:text-[#0077b5]">
                  <RefreshCw className="h-3.5 w-3.5" />
                </a>
              </div>

              {/* X */}
              <div className="flex items-center gap-3 px-5 py-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm ${xActive ? "bg-slate-900" : "bg-slate-200"}`}>
                  <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-slate-800">X / Twitter</p>
                    {xActive
                      ? <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600"><Wifi className="h-2.5 w-2.5" /> Active</span>
                      : <span className="flex items-center gap-0.5 text-[10px] font-bold text-slate-400"><WifiOff className="h-2.5 w-2.5" /> Not connected</span>}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {connections.x?.username ? `@${connections.x.username}` : "Connect to publish"}
                  </p>
                </div>
                <a href="/api/oauth/x/start"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition hover:border-slate-900 hover:text-slate-900">
                  <RefreshCw className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            <div className="border-t border-slate-100 px-5 py-3">
              <Link href="/settings/connections"
                className="flex items-center justify-between text-[11px] font-semibold text-indigo-600 transition hover:text-indigo-700">
                Manage connections
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Quick links */}
          <div className="card-lift rounded-2xl border border-slate-200/70 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-3.5">
              <h2 className="text-sm font-bold text-slate-900">Quick Links</h2>
            </div>
            {[
              { label: "Brand settings", desc: "Voice, prompt & tone", href: "/settings/brand", color: "text-indigo-600 bg-indigo-50" },
              { label: "Posting schedule", desc: "Configure time slots", href: "/settings/schedule", color: "text-violet-600 bg-violet-50" },
              { label: "Post queue", desc: "Manage upcoming posts", href: "/queue", color: "text-emerald-600 bg-emerald-50" },
            ].map((l) => (
              <Link key={l.href} href={l.href}
                className="flex items-center justify-between px-5 py-3.5 border-b border-slate-50 last:border-0 transition hover:bg-slate-50/60 group">
                <div>
                  <p className="text-xs font-semibold text-slate-800 group-hover:text-slate-900">{l.label}</p>
                  <p className="text-[11px] text-slate-400">{l.desc}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:text-indigo-400" />
              </Link>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
