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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-accent ring-1 ring-inset ring-border">
            <Calendar className="h-5 w-5" />
          </div>
          <div>
            <h1 className="display-lg text-3xl text-foreground">
              Post Queue
            </h1>
            <p className="text-xs text-faint-foreground">
              Active pipeline · next 72 hours
            </p>
          </div>
        </div>

        <Link href="/chat">
          <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-sm transition hover:brightness-110 active:scale-[0.97]">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            New Post
          </button>
        </Link>
      </div>

      {/* ── Stat Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Upcoming count */}
        <div className="panel panel-hover animate-fade-up relative overflow-hidden p-5">
          <div className="pointer-events-none absolute right-2 top-1 text-accent/10">
            <Zap className="h-16 w-16" fill="currentColor" />
          </div>
          <p className="micro-label">
            Upcoming Posts
          </p>
          <div className="mt-3 flex items-end gap-2">
            <p className="mono-num text-5xl font-bold leading-none text-accent">
              {allPosts.length}
            </p>
            <p className="mb-0.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Scheduled
            </p>
          </div>
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground">
            <Clock className="h-3 w-3 text-accent" />
            <span className="mono-num">{nextDate
              ? `Next ${formatDistanceToNow(nextDate, { addSuffix: true })}`
              : "No upcoming posts"}</span>
          </div>
        </div>

        {/* Platform breakdown */}
        <div className="panel panel-hover animate-fade-up p-5" style={{ animationDelay: "60ms" }}>
          <p className="micro-label">
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
                  <span className="text-xs font-medium text-muted-foreground">LinkedIn</span>
                  <span className="mono-num text-xs font-bold text-foreground">{linkedinCount}</span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-[#0077b5]"
                    style={{ width: allPosts.length ? `${(linkedinCount / allPosts.length) * 100}%` : "0%" }}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 ring-1 ring-border">
                <svg className="h-3 w-3 text-foreground" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">X / Twitter</span>
                  <span className="mono-num text-xs font-bold text-foreground">{xCount}</span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-grey-2"
                    style={{ width: allPosts.length ? `${(xCount / allPosts.length) * 100}%` : "0%" }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Platform Tabs ───────────────────────────────────── */}
      <div className="flex items-center gap-1 rounded-xl bg-surface p-1 ring-1 ring-border">
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
                  ? "bg-surface-2 text-foreground ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              <span
                className={`mono-num rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  isActive
                    ? "bg-accent/20 text-accent"
                    : "bg-white/[0.06] text-faint-foreground"
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
