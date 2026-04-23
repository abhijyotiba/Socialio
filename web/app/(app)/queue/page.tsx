"use client";

import { useEffect, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { Loader2, CalendarClock } from "lucide-react";
import Link from "next/link";

type ScheduledVariant = {
  id: string;
  platform: string;
  status: string;
  scheduled_at: string | null;
  content: string;
  created_at: string;
};

const platformStyles: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  linkedin: {
    label: "LinkedIn",
    bg: "bg-[#e8f4fb]",
    text: "text-[#0077b5]",
    dot: "bg-[#0077b5]",
  },
  x: {
    label: "X / Twitter",
    bg: "bg-gray-100",
    text: "text-gray-800",
    dot: "bg-black",
  },
};

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

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Delivery pipeline
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">
            Queue
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {scheduledCount} post{scheduledCount !== 1 ? "s" : ""} scheduled
          </p>
        </div>
        <Link href="/chat">
          <button className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_-14px_rgba(79,70,229,0.85)] transition hover:opacity-95">
            + New Post
          </button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl bg-gradient-to-br from-indigo-600 to-violet-600 p-5 text-white shadow-[0_20px_44px_-24px_rgba(79,70,229,0.95)]">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-200">
              Scheduled
            </p>
            <CalendarClock className="h-4 w-4 text-indigo-200" />
          </div>
          <p className="text-4xl font-black tracking-tight">{scheduledCount}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="font-bold text-slate-900">Upcoming Posts</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Posts waiting to auto-publish at their scheduled time
          </p>
        </div>

        {scheduledCount === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50">
              <CalendarClock className="h-5 w-5 text-indigo-400" />
            </div>
            <p className="font-semibold text-slate-800">Queue is empty</p>
            <p className="mt-1 max-w-xs text-sm text-slate-500">
              Schedule posts from Chat to see them here.
            </p>
            <Link href="/chat">
              <button className="mt-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_28px_-16px_rgba(79,70,229,0.9)] transition hover:opacity-95">
                Create a post
              </button>
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {data?.map((variant) => {
              const plt = platformStyles[variant.platform] ?? {
                label: variant.platform,
                bg: "bg-gray-100",
                text: "text-gray-700",
                dot: "bg-gray-400",
              };
              return (
                <div
                  key={variant.id}
                  className="flex items-start gap-4 px-6 py-4 transition-colors hover:bg-slate-50/60"
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <span className={`mt-1.5 inline-block h-2 w-2 rounded-full ${plt.dot}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${plt.bg} ${plt.text}`}
                      >
                        {plt.label}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-sm leading-relaxed text-slate-700">
                      {variant.content || "—"}
                    </p>
                  </div>

                  <div className="flex-shrink-0 text-right">
                    {variant.scheduled_at ? (
                      <>
                        <p className="text-sm font-semibold text-slate-800">
                          {format(new Date(variant.scheduled_at), "MMM d, h:mm a")}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatDistanceToNow(new Date(variant.scheduled_at), {
                            addSuffix: true,
                          })}
                        </p>
                      </>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
