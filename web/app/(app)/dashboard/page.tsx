"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2, TrendingUp, Eye, Heart, MessageCircle } from "lucide-react";
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

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Performance
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {format(new Date(), "EEEE, MMMM d")}
          </p>
        </div>
        <Link href="/chat">
          <button className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_28px_-14px_rgba(79,70,229,0.85)] transition hover:opacity-95">
            + New Post
          </button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 p-5 text-white shadow-[0_20px_44px_-24px_rgba(79,70,229,0.95)]">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-200">
              Posts Published
            </p>
            <TrendingUp className="h-4 w-4 text-indigo-200" />
          </div>
          <p className="text-4xl font-black tracking-tight">{publishedCount}</p>
        </div>

        <div className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Impressions
            </p>
            <Eye className="h-4 w-4 text-slate-400" />
          </div>
          <p className="text-4xl font-black tracking-tight text-slate-900">
            {totalImpressions > 0 ? totalImpressions.toLocaleString() : "—"}
          </p>
        </div>

        <div className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Total Likes
            </p>
            <Heart className="h-4 w-4 text-slate-400" />
          </div>
          <p className="text-4xl font-black tracking-tight text-slate-900">
            {totalLikes > 0 ? totalLikes.toLocaleString() : "—"}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="font-bold text-slate-900">Recent Posts</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Published in the last 30 days
            </p>
          </div>
        </div>

        {(data?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50">
              <TrendingUp className="h-5 w-5 text-indigo-400" />
            </div>
            <p className="font-semibold text-slate-800">No posts yet</p>
            <p className="mt-1 max-w-xs text-sm text-slate-500">
              Generate and publish your first post to see analytics here.
            </p>
            <Link href="/chat">
              <button className="mt-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_28px_-16px_rgba(79,70,229,0.9)] transition hover:opacity-95">
                Create your first post
              </button>
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Platform
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  Published
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <Eye className="inline h-3.5 w-3.5" />
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <Heart className="inline h-3.5 w-3.5" />
                </th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <MessageCircle className="inline h-3.5 w-3.5" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data?.slice(0, 10).map((variant) => {
                const metrics = getMetrics(variant.post_metrics);
                const plt =
                  platformStyles[variant.platform] ?? {
                    label: variant.platform,
                    dot: "bg-gray-400",
                  };
                return (
                  <tr
                    key={variant.id}
                    className="transition-colors hover:bg-slate-50/70"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full ${plt.dot}`} />
                        <span className="font-medium text-slate-800">
                          {plt.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {variant.published_at
                        ? format(
                            new Date(variant.published_at),
                            "MMM d, h:mm a"
                          )
                        : "—"}
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-slate-700">
                      {metrics
                        ? (metrics.impressions?.toLocaleString() ?? "—")
                        : <span className="text-xs text-slate-300">Pending</span>}
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-slate-700">
                      {metrics
                        ? (metrics.likes?.toLocaleString() ?? "—")
                        : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-slate-700">
                      {metrics
                        ? (metrics.comments?.toLocaleString() ?? "—")
                        : <span className="text-xs text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
