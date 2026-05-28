import { formatDistanceToNow } from "date-fns";
import { Calendar, CalendarClock, Clock, Plus, Zap } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { listScheduledVariants } from "@/lib/db/posts";
import { QueueList } from "./_components/QueueList";

type Tab = "all" | "linkedin" | "x";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X / Twitter" },
];

function getNextScheduledDate(items: { scheduled_at: string | null }[]): Date | null {
  const ts = items
    .map((i) => i.scheduled_at)
    .filter((v): v is string => Boolean(v))
    .map((v) => new Date(v).getTime())
    .filter((v) => !Number.isNaN(v))
    .sort((a, b) => a - b);
  return ts.length ? new Date(ts[0]) : null;
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const activeTab: Tab =
    tabParam === "linkedin" || tabParam === "x" ? tabParam : "all";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/onboarding");

  const allPosts = await listScheduledVariants();

  const linkedinCount = allPosts.filter((p) => p.platform === "linkedin").length;
  const xCount = allPosts.filter((p) => p.platform === "x").length;
  const nextDate = getNextScheduledDate(allPosts);

  const filtered =
    activeTab === "all"
      ? allPosts
      : allPosts.filter((p) => p.platform === activeTab);

  function tabCount(tab: Tab) {
    if (tab === "all") return allPosts.length;
    return allPosts.filter((p) => p.platform === tab).length;
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-12 page-enter">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-500 ring-1 ring-inset ring-indigo-100">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              Post Queue
            </h1>
            <p className="text-xs text-slate-400">
              Active pipeline · next 72 hours
            </p>
          </div>
        </div>

        <Link href="/chat">
          <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.97]">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            New Post
          </button>
        </Link>
      </div>

      {/* ── Stat Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Upcoming count */}
        <div className="card-lift animate-fade-up relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-500 p-5 text-white shadow-lg shadow-indigo-200/50">
          <div className="pointer-events-none absolute right-2 top-1 opacity-[0.12]">
            <Zap className="h-16 w-16" fill="currentColor" />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-200/80">
            Upcoming Posts
          </p>
          <div className="mt-3 flex items-end gap-2">
            <p className="text-5xl font-bold leading-none tracking-tight">
              {allPosts.length}
            </p>
            <p className="mb-0.5 text-xs font-bold uppercase tracking-wide text-indigo-100">
              Scheduled
            </p>
          </div>
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-100">
            <Clock className="h-3 w-3" />
            {nextDate
              ? `Next ${formatDistanceToNow(nextDate, { addSuffix: true })}`
              : "No upcoming posts"}
          </div>
        </div>

        {/* Platform breakdown */}
        <div className="card-lift animate-fade-up rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm" style={{ animationDelay: "60ms" }}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
            By Platform
          </p>
          <div className="mt-3 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0077b5]">
                <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">LinkedIn</span>
                  <span className="text-xs font-bold text-slate-800">{linkedinCount}</span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-[#0077b5]"
                    style={{ width: allPosts.length ? `${(linkedinCount / allPosts.length) * 100}%` : "0%" }}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900">
                <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">X / Twitter</span>
                  <span className="text-xs font-bold text-slate-800">{xCount}</span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-900"
                    style={{ width: allPosts.length ? `${(xCount / allPosts.length) * 100}%` : "0%" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Platform Tabs ───────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
        {TABS.map((tab) => {
          const count = tabCount(tab.id);
          const isActive = activeTab === tab.id;
          const href = tab.id === "all" ? "/queue" : `/queue?tab=${tab.id}`;
          return (
            <Link
              key={tab.id}
              href={href}
              scroll={false}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                isActive
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  isActive
                    ? "bg-indigo-100 text-indigo-600"
                    : "bg-slate-200/70 text-slate-400"
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      <QueueList items={filtered} emptyTab={activeTab} />
    </div>
  );
}
