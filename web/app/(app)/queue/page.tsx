"use client";

import { useEffect, useState } from "react";
import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";
import {
  Loader2,
  Calendar,
  CalendarClock,
  Clock,
  Plus,
  Zap,
  ArrowUpRight,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

type ScheduledVariant = {
  id: string;
  platform: string;
  status: string;
  scheduled_at: string | null;
  content: string;
  created_at: string;
};

const PLATFORMS: Record<string, { label: string; tile: string; glyph: string }> = {
  linkedin: { label: "LinkedIn", tile: "bg-[#0077b5]", glyph: "in" },
  x: { label: "X / Twitter", tile: "bg-gray-900", glyph: "X" },
};

function formatScheduled(date: Date): string {
  if (isToday(date)) return `Today, ${format(date, "h:mm a")}`;
  if (isTomorrow(date)) return `Tomorrow, ${format(date, "h:mm a")}`;
  return format(date, "MMM d, h:mm a");
}

function relativeLabel(date: Date): string {
  const raw = formatDistanceToNow(date, { addSuffix: false })
    .replace("about ", "")
    .replace("less than a minute", "moments")
    .toUpperCase();
  return `IN ${raw}`;
}

function getNextScheduledDate(items: ScheduledVariant[] | null): Date | null {
  if (!items?.length) return null;
  const ts = items
    .map((i) => i.scheduled_at)
    .filter((v): v is string => Boolean(v))
    .map((v) => new Date(v).getTime())
    .filter((v) => !Number.isNaN(v))
    .sort((a, b) => a - b);
  return ts.length ? new Date(ts[0]) : null;
}

export default function QueuePage() {
  const [data, setData] = useState<ScheduledVariant[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/queue")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch queue");
        return res.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-500">{error}</p>
        <button onClick={() => window.location.reload()} className="text-sm text-indigo-600 underline">
          Retry
        </button>
      </div>
    );
  }

  const scheduledCount = data?.length ?? 0;
  const nextDate = getNextScheduledDate(data);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-7 pb-12">

      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500 ring-1 ring-indigo-100">
            <Calendar className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900">Post Queue</h1>
            <p className="mt-0.5 text-sm italic text-slate-500">
              Active pipeline for the next 72 hours.
            </p>
          </div>
        </div>

        <Link href="/chat">
          <button className="inline-flex h-11 items-center gap-2.5 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 text-sm font-bold text-white shadow-lg shadow-indigo-200/60 transition-transform hover:scale-[1.02] active:scale-[0.98]">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Queue New Post
          </button>
        </Link>
      </div>

      {/* ── Stat Cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">

        {/* Upcoming count */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-500 p-6 text-white shadow-xl shadow-indigo-200/50">
          <div className="pointer-events-none absolute right-3 top-2 opacity-[0.13] transition-opacity group-hover:opacity-20">
            <Zap className="h-20 w-20" fill="currentColor" />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-indigo-200/80">
            Upcoming Posts
          </p>
          <div className="mt-4 flex items-end gap-2.5">
            <p className="text-6xl font-bold leading-none tracking-tight">{scheduledCount}</p>
            <p className="mb-1 text-sm font-bold uppercase tracking-wide text-indigo-100">
              Scheduled
            </p>
          </div>
          <div className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-indigo-100">
            <Clock className="h-3.5 w-3.5" />
            {nextDate ? `Next post ${formatDistanceToNow(nextDate, { addSuffix: true })}` : "No upcoming posts"}
          </div>
        </div>

        {/* Optimization summary */}
        <div className="rounded-3xl border border-slate-200/60 bg-white/80 p-6 shadow-sm backdrop-blur-sm md:col-span-2">
          <h2 className="text-xl font-bold text-slate-900">Optimization Summary</h2>
          <div className="mt-5 flex flex-wrap items-center gap-x-10 gap-y-4">
            <div>
              <p className="text-4xl font-bold tracking-tight text-slate-900">0</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Gaps Detected
              </p>
            </div>
            <div className="hidden h-10 w-px bg-slate-200 sm:block" />
            <div>
              <p className="flex items-center gap-1 text-4xl font-bold tracking-tight text-slate-900">
                Peak
                <ArrowUpRight className="h-5 w-5 text-emerald-500" />
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Target Engagement
              </p>
            </div>
            <div className="sm:ml-auto">
              <span className="inline-block rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-2 text-xs font-bold uppercase tracking-widest text-emerald-700">
                Schedule Optimized
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Queue List ──────────────────────────────────────────── */}
      <div className="space-y-3">
        {scheduledCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-200/60 bg-white/80 px-6 py-20 text-center shadow-sm backdrop-blur-sm">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-300">
              <CalendarClock className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Your queue is empty</h3>
            <p className="mt-1 text-sm text-slate-500">Generate some content to get started.</p>
            <Link href="/chat">
              <button className="mt-6 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-7 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-95">
                Go to Content Studio
              </button>
            </Link>
          </div>
        ) : (
          data?.map((variant) => {
            const plt = PLATFORMS[variant.platform] ?? {
              label: variant.platform,
              tile: "bg-slate-300",
              glyph: "?",
            };
            const scheduledDate = variant.scheduled_at ? new Date(variant.scheduled_at) : null;

            return (
              <div
                key={variant.id}
                className="group flex items-center gap-4 rounded-2xl border border-slate-200/60 bg-white px-5 py-4 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md"
              >
                {/* Platform icon */}
                <div
                  className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl ${plt.tile} shadow-md transition-transform duration-200 group-hover:scale-[1.03]`}
                >
                  <span className="text-[22px] font-black leading-none text-white">
                    {plt.glyph}
                  </span>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-slate-800 group-hover:text-slate-900">
                    {variant.content || "—"}
                  </p>

                  <div className="mt-1.5 flex items-center gap-3">
                    {scheduledDate ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-500">
                          <Clock className="h-3.5 w-3.5" />
                          {formatScheduled(scheduledDate)}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                          {relativeLabel(scheduledDate)}
                        </span>
                      </>
                    ) : (
                      <span className="text-[12px] text-slate-400">Not scheduled</span>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <ChevronRight className="h-5 w-5 flex-shrink-0 text-slate-300 transition-colors group-hover:text-indigo-400" />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
