"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Loader2,
  TrendingUp,
  Heart,
  MessageCircle,
  Plus,
  ArrowUpRight,
  MoreVertical,
  Zap,
} from "lucide-react";
import Link from "next/link";

type VariantWithMetrics = {
  id: string;
  platform: string;
  status: string;
  published_at: string | null;
  post_metrics:
    | {
        impressions: number | null;
        likes: number | null;
        comments: number | null;
        shares: number | null;
        last_synced_at: string | null;
      }[]
    | {
        impressions: number | null;
        likes: number | null;
        comments: number | null;
        shares: number | null;
        last_synced_at: string | null;
      }
    | null;
};

const platformStyles: Record<string, { label: string; dot: string }> = {
  linkedin: { label: "LinkedIn", dot: "bg-[#0077b5]" },
  x: { label: "X / Twitter", dot: "bg-black" },
};

function metricPoints(items: VariantWithMetrics[] | null, key: "impressions" | "likes") {
  const getMetricValue = (m: VariantWithMetrics["post_metrics"]) => {
    if (!m) return 0;
    const value = Array.isArray(m) ? m[0]?.[key] : m[key];
    return value ?? 0;
  };

  const values = (items ?? []).slice(0, 7).map((row) => getMetricValue(row.post_metrics));
  const fallback = [42, 35, 28, 33, 30, 34, 40];
  const points = values.length > 0 ? values : fallback;
  const max = Math.max(...points, 1);

  return points.map((v) => Math.max(8, Math.round((v / max) * 100)));
}

export default function DashboardPage() {
  const [data, setData] = useState<VariantWithMetrics[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/metrics")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch metrics");
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
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-500">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm text-indigo-600 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const getMetrics = (metrics: VariantWithMetrics["post_metrics"]) => {
    if (!metrics) return null;
    if (Array.isArray(metrics)) return metrics[0];
    return metrics;
  };

  const publishedCount = data?.length || 0;
  const totalImpressions =
    data?.reduce(
      (acc, curr) => acc + (getMetrics(curr.post_metrics)?.impressions || 0),
      0
    ) || 0;
  const totalLikes =
    data?.reduce(
      (acc, curr) => acc + (getMetrics(curr.post_metrics)?.likes || 0),
      0
    ) || 0;

  const impressionBars = metricPoints(data, "impressions");
  const likeBars = metricPoints(data, "likes");

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 pb-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Brand Overview</h1>
          <p className="mt-1 text-sm font-medium italic text-slate-500">
            Your engagement intelligence for the last 7 days.
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
            {format(new Date(), "EEEE, MMMM d")}
          </p>
        </div>
        <Link href="/chat">
          <button className="inline-flex h-12 items-center gap-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-8 text-sm font-bold text-white shadow-xl shadow-indigo-200/70 transition-transform hover:scale-[1.03] active:scale-[0.97]">
            <Plus className="h-4.5 w-4.5" strokeWidth={2.6} />
            <span>Create New Post</span>
          </button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 text-white shadow-2xl shadow-indigo-200/60">
          <div className="absolute right-1 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
            <Zap className="h-28 w-28" fill="currentColor" />
          </div>
          <div className="px-6 pb-6 pt-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">Total Posts</p>
            <div className="mt-3 flex items-end gap-2">
              <h2 className="text-5xl font-bold leading-none">{publishedCount}</h2>
              <span className="inline-flex items-center rounded-lg bg-white/20 px-2 py-0.5 text-xs font-bold">
                <TrendingUp className="mr-1 h-3 w-3" strokeWidth={3} /> +12%
              </span>
            </div>
            <p className="mt-6 text-xs font-medium tracking-wide text-white/65">
              Most active in AI/Expert sector
            </p>
          </div>
        </div>

        <div className="rounded-3xl border border-white/60 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Total Impressions</p>
          <div className="mt-3 flex items-end gap-2">
            <h2 className="text-5xl font-bold leading-none tracking-tight text-slate-900">
              {totalImpressions > 0 ? totalImpressions.toLocaleString() : "0"}
            </h2>
            <span className="inline-flex items-center rounded-lg bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-600">
              <TrendingUp className="mr-1 h-3 w-3" strokeWidth={3} /> +24%
            </span>
          </div>
          <div className="mt-6 h-[70px] rounded-2xl bg-indigo-50/70 px-2 py-2">
            <div className="flex h-full items-end gap-1.5">
              {impressionBars.map((h, i) => (
                <div
                  key={`impressions-${i}`}
                  className="flex-1 rounded-t-md bg-indigo-500/75"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/60 bg-white/70 p-5 shadow-sm backdrop-blur-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Cumulative Likes</p>
          <div className="mt-3 flex items-end gap-2">
            <h2 className="text-5xl font-bold leading-none tracking-tight text-slate-900">
              {totalLikes > 0 ? totalLikes.toLocaleString() : "0"}
            </h2>
            <span className="inline-flex items-center rounded-lg bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-600">
              <TrendingUp className="mr-1 h-3 w-3" strokeWidth={3} /> +8%
            </span>
          </div>
          <div className="mt-6 h-[70px] rounded-2xl bg-violet-50/70 px-2 py-2">
            <div className="flex h-full items-end gap-1.5">
              {likeBars.map((h, i) => (
                <div
                  key={`likes-${i}`}
                  className="flex-1 rounded-t-md bg-violet-500/80"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="overflow-hidden rounded-3xl border border-white/60 bg-white/70 shadow-sm backdrop-blur-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 p-8">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Engagement Performance</h2>
              <p className="mt-1 text-xs font-medium uppercase tracking-widest text-slate-400">
                Real-time daily metrics
              </p>
            </div>
            <button className="h-10 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
              Export PDF
            </button>
          </div>
          <div className="p-8">
            <div className="h-[300px] rounded-2xl border border-slate-200/70 bg-slate-50/50 p-4">
              <div className="relative h-full w-full overflow-hidden rounded-xl bg-[linear-gradient(to_bottom,rgba(79,70,229,0.08),rgba(79,70,229,0.02))]">
                <div className="absolute inset-0 flex items-end gap-2 p-4">
                  {impressionBars.map((h, i) => (
                    <div
                      key={`area-${i}`}
                      className="flex-1 rounded-t-lg bg-indigo-500/70"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
                <div className="absolute bottom-2 left-4 right-4 flex justify-between text-[11px] font-semibold text-slate-400">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/60 bg-white/70 shadow-xl backdrop-blur-sm">
          <div className="px-8 pt-8">
            <h2 className="text-xl font-bold text-slate-900">Live Stream</h2>
            <p className="text-xs font-medium uppercase tracking-widest text-slate-400">Latest interactions</p>
          </div>

          {(data?.length ?? 0) === 0 ? (
            <div className="px-8 py-12 text-center">
              <p className="font-semibold text-slate-800">No posts yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Generate and publish your first post to see analytics here.
              </p>
              <Link href="/chat">
                <button className="mt-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_28px_-16px_rgba(79,70,229,0.9)] transition hover:opacity-95">
                  Create your first post
                </button>
              </Link>
            </div>
          ) : (
            <>
              <div className="mt-4 divide-y divide-slate-100">
                {data?.slice(0, 6).map((variant) => {
                  const metrics = getMetrics(variant.post_metrics);
                  const plt =
                    platformStyles[variant.platform] ?? {
                      label: variant.platform,
                      dot: "bg-gray-400",
                    };

                  return (
                    <div
                      key={variant.id}
                      className="group cursor-pointer p-6 transition-all hover:bg-white/60"
                    >
                      <div className="flex gap-4">
                        <div
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg transition-transform group-hover:scale-105 ${
                            variant.platform === "linkedin" ? "bg-[#0077b5]" : "bg-black"
                          }`}
                        >
                          <span className="text-sm font-black leading-none">
                            {variant.platform === "linkedin" ? "in" : "X"}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                              {variant.published_at
                                ? format(new Date(variant.published_at), "MMM d, yyyy")
                                : "Pending"}
                            </span>
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/30 opacity-0 transition-opacity group-hover:opacity-100">
                              <MoreVertical className="h-3.5 w-3.5 text-slate-500" />
                            </div>
                          </div>

                          <p className="line-clamp-2 text-sm font-bold leading-relaxed text-slate-800">
                            {plt.label} post activity snapshot
                          </p>

                          <div className="flex items-center gap-2 pt-1">
                            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/40 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                              <Heart className="h-3 w-3" fill="currentColor" />
                              {metrics?.likes?.toLocaleString() ?? "0"}
                            </div>
                            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/40 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                              <MessageCircle className="h-3 w-3" fill="currentColor" />
                              {metrics?.comments?.toLocaleString() ?? "0"}
                            </div>
                            <div className="ml-auto inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-tight text-indigo-600">
                              {metrics?.impressions?.toLocaleString() ?? "0"}
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-6">
                <button className="h-10 w-full rounded-xl text-xs font-black uppercase tracking-widest text-indigo-600 transition hover:bg-indigo-50/60">
                  All Activity Log
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
