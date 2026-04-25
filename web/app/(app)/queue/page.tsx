"use client";

import { useEffect, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
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

const platformStyles: Record<
  string,
  {
    label: string;
    bg: string;
    text: string;
    dot: string;
    tile: string;
    glyph: string;
    glyphClass: string;
  }
> = {
  linkedin: {
    label: "LinkedIn",
    bg: "bg-[#eef6ff]",
    text: "text-[#0077b5]",
    dot: "bg-[#0077b5]",
    tile: "bg-[#0077b5] text-white",
    glyph: "in",
    glyphClass: "text-[30px] font-black leading-none",
  },
  x: {
    label: "X / Twitter",
    bg: "bg-slate-100",
    text: "text-gray-800",
    dot: "bg-black",
    tile: "bg-black text-white",
    glyph: "X",
    glyphClass: "text-[30px] font-black leading-none",
  },
};

function getNextScheduledDate(items: ScheduledVariant[] | null): Date | null {
  if (!items?.length) return null;

  const timestamps = items
    .map((item) => item.scheduled_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value))
    .sort((a, b) => a - b);

  return timestamps.length ? new Date(timestamps[0]) : null;
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
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
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
      <div className="flex h-full items-center justify-center flex-col gap-4">
        <p className="text-red-500 text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-indigo-600 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const scheduledCount = data?.length ?? 0;
  const nextScheduledDate = getNextScheduledDate(data);
  const nextRelativeLabel = nextScheduledDate
    ? formatDistanceToNow(nextScheduledDate, { addSuffix: true })
    : "No upcoming posts";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 pb-12">
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600/10 text-indigo-600 shadow-inner shadow-indigo-200/60">
            <Calendar className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900 md:text-4xl">
              Post Queue
            </h1>
            <p className="mt-1 text-sm font-medium italic text-slate-500">
              Active pipeline for the next 72 hours.
            </p>
          </div>
        </div>

        <Link href="/chat">
          <button className="inline-flex h-14 items-center gap-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 text-sm font-extrabold text-white shadow-[0_20px_48px_-22px_rgba(99,102,241,0.85)] transition-transform hover:scale-[1.02] active:scale-[0.98]">
            <Plus className="h-5 w-5" strokeWidth={2.5} />
            <span>Queue New Post</span>
          </button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-600 p-6 text-white shadow-[0_28px_64px_-26px_rgba(99,102,241,0.9)]">
          <div className="absolute right-2 top-1 opacity-15 transition-opacity group-hover:opacity-25">
            <Zap className="h-20 w-20" fill="currentColor" />
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-indigo-200/90">
            Upcoming Posts
          </p>
          <div className="mt-4 flex items-end gap-2">
            <p className="text-6xl leading-none font-black tracking-tight">{scheduledCount}</p>
            <p className="pb-1 text-sm font-black uppercase tracking-tight text-indigo-100">Scheduled</p>
          </div>
          <div className="mt-6 inline-flex items-center gap-2 rounded-lg bg-white/12 px-3 py-1 text-xs font-bold text-indigo-100">
            <Clock className="h-3.5 w-3.5" />
            {nextScheduledDate ? `Next post ${nextRelativeLabel}` : "No upcoming posts"}
          </div>
        </div>

        <div className="md:col-span-2 rounded-3xl border border-white/60 bg-white/70 p-6 shadow-[0_16px_44px_-26px_rgba(15,23,42,0.45)] backdrop-blur-xl">
          <h2 className="text-2xl font-black tracking-tight text-slate-900">Optimization Summary</h2>
          <div className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-5">
            <div>
              <p className="text-4xl font-black tracking-tight text-slate-900">0</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                Gaps Detected
              </p>
            </div>

            <div className="hidden h-12 w-px bg-slate-200 sm:block" />

            <div>
              <p className="flex items-center gap-1 text-4xl font-black tracking-tight text-slate-900">
                Peak
                <ArrowUpRight className="h-5 w-5 text-emerald-500" />
              </p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                Target Engagement
              </p>
            </div>

            <div className="sm:ml-auto">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-500/10 px-5 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                Schedule Optimized
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {scheduledCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-200/70 bg-white/80 px-6 py-20 text-center shadow-sm backdrop-blur-sm">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-slate-100 text-slate-300">
              <CalendarClock className="h-10 w-10" />
            </div>
            <h3 className="text-xl font-black text-slate-900">Your queue is empty</h3>
            <p className="mt-1 text-sm text-slate-500">Generate some content to get started.</p>
            <Link href="/chat">
              <button className="mt-6 h-12 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 text-sm font-bold text-white shadow-[0_16px_40px_-24px_rgba(79,70,229,0.9)] transition hover:opacity-95">
                Go to Content Studio
              </button>
            </Link>
          </div>
        ) : (
          data?.map((variant) => {
            const plt = platformStyles[variant.platform] ?? {
              label: variant.platform,
              bg: "bg-slate-100",
              text: "text-slate-700",
              dot: "bg-slate-400",
              tile: "bg-slate-200 text-slate-700",
              glyph: "?",
              glyphClass: "text-2xl font-black leading-none",
            };

            return (
              <div
                key={variant.id}
                className="group flex items-center gap-4 rounded-3xl border border-white/70 bg-white/75 px-5 py-5 shadow-[0_10px_34px_-24px_rgba(15,23,42,0.45)] backdrop-blur-md transition-all hover:border-indigo-200 hover:bg-white"
              >
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-[22px] text-white shadow-lg transition-transform duration-300 group-hover:scale-[1.04]">
                  <div className={`flex h-full w-full items-center justify-center rounded-[22px] ${plt.tile}`}>
                    <span className={plt.glyphClass}>{plt.glyph}</span>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-lg font-black tracking-tight text-slate-800 transition-colors group-hover:text-indigo-600">
                    {variant.content || "—"}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${plt.bg} ${plt.text}`}
                    >
                      <span className={`mr-2 h-2 w-2 rounded-full ${plt.dot}`} />
                      {plt.label}
                    </span>

                    {variant.scheduled_at ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-1.5 text-[11px] font-black text-indigo-600">
                          <Clock className="h-3.5 w-3.5" />
                          {format(new Date(variant.scheduled_at), "MMM d, h:mm a")}
                        </span>

                        <span className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500">
                          {formatDistanceToNow(new Date(variant.scheduled_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </div>
                </div>

                <ChevronRight className="mr-1 h-5 w-5 flex-shrink-0 text-slate-300 transition-colors group-hover:text-indigo-300" />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
