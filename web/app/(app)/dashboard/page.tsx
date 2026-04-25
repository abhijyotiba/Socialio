"use client";

import { useEffect, useState, useId } from "react";
import { format } from "date-fns";
import { Loader2, Plus, TrendingUp, Zap, Heart, MessageCircle, Clock } from "lucide-react";
import Link from "next/link";

type PostMetrics = {
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  last_synced_at: string | null;
};

type VariantWithMetrics = {
  id: string;
  platform: string;
  status: string;
  published_at: string | null;
  post_metrics: PostMetrics[] | PostMetrics | null;
};

type QueueItem = {
  id: string;
  platform: string;
  status: string;
  scheduled_at: string | null;
  content: string;
  created_at: string;
};

const FALLBACK = [42, 35, 28, 33, 30, 34, 40];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getMetric(m: PostMetrics[] | PostMetrics | null): PostMetrics | null {
  if (!m) return null;
  return Array.isArray(m) ? (m[0] ?? null) : m;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C ${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
  }
  return d;
}

function MainLineChart({ data }: { data: number[] }) {
  const uid = useId().replace(/:/g, "x");
  const W = 560;
  const H = 200;
  const padL = 48;
  const padR = 16;
  const padT = 12;
  const padB = 32;
  const cW = W - padL - padR;
  const cH = H - padT - padB;
  const max = Math.max(...data, 1);

  const pts = data.map((v, i) => ({
    x: padL + (i / (data.length - 1)) * cW,
    y: padT + (1 - v / max) * cH,
  }));

  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1].x},${padT + cH} L ${pts[0].x},${padT + cH} Z`;

  const tickCount = 4;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const val = Math.round((max / tickCount) * (tickCount - i));
    return { val, y: padT + (i / tickCount) * cH };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      <defs>
        <linearGradient id={`lg-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={padL} y1={t.y} x2={W - padR} y2={t.y}
            stroke="#e2e8f0" strokeWidth="1" strokeDasharray="3 5"
          />
          <text x={padL - 8} y={t.y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
            {t.val >= 1000 ? `${(t.val / 1000).toFixed(0)}k` : t.val === 0 ? "0" : t.val}
          </text>
        </g>
      ))}

      <path d={area} fill={`url(#lg-${uid})`} />
      <path d={line} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#fff" stroke="#6366f1" strokeWidth="2" />
      ))}

      {DAYS.map((d, i) => (
        <text
          key={d}
          x={padL + (i / (DAYS.length - 1)) * cW}
          y={H - 6}
          textAnchor="middle"
          fontSize="10"
          fill="#94a3b8"
        >
          {d}
        </text>
      ))}
    </svg>
  );
}

function MiniLine({ data, color = "#6366f1" }: { data: number[]; color?: string }) {
  const uid = useId().replace(/:/g, "x");
  const W = 200;
  const H = 56;
  const px = 2;
  const py = 2;
  const cW = W - px * 2;
  const cH = H - py * 2;
  const max = Math.max(...data, 1);

  const pts = data.map((v, i) => ({
    x: px + (i / (data.length - 1)) * cW,
    y: py + (1 - v / max) * cH,
  }));

  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1].x},${H - py} L ${pts[0].x},${H - py} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`ml-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#ml-${uid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MiniBars({ data, color = "#8b5cf6" }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex h-full items-end gap-1">
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm"
          style={{
            height: `${Math.max(10, (v / max) * 100)}%`,
            backgroundColor: color,
            opacity: 0.55 + (i / data.length) * 0.45,
          }}
        />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<VariantWithMetrics[] | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/metrics").then((r) => {
        if (!r.ok) throw new Error("metrics");
        return r.json();
      }),
      fetch("/api/queue").then((r) => {
        if (!r.ok) throw new Error("queue");
        return r.json();
      }),
    ])
      .then(([m, q]) => {
        setMetrics(Array.isArray(m) ? m : []);
        setQueue(Array.isArray(q) ? q : []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load dashboard.");
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
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-red-500">{error}</p>
        <button onClick={() => window.location.reload()} className="text-sm text-indigo-600 underline">
          Retry
        </button>
      </div>
    );
  }

  const publishedCount = metrics?.length ?? 0;
  const totalImpressions =
    metrics?.reduce((acc, v) => acc + (getMetric(v.post_metrics)?.impressions ?? 0), 0) ?? 0;
  const totalLikes =
    metrics?.reduce((acc, v) => acc + (getMetric(v.post_metrics)?.likes ?? 0), 0) ?? 0;

  const hasRealData = totalImpressions > 0 || totalLikes > 0;
  const impressionVals = hasRealData
    ? (metrics ?? []).slice(0, 7).map((v) => getMetric(v.post_metrics)?.impressions ?? 0)
    : FALLBACK;
  const likeVals = hasRealData
    ? (metrics ?? []).slice(0, 7).map((v) => getMetric(v.post_metrics)?.likes ?? 0)
    : FALLBACK;

  const liveItems = (queue ?? []).slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Brand Overview</h1>
          <p className="mt-1 text-sm italic text-slate-500">
            Your engagement intelligence for the last 7 days.
          </p>
          <p className="mt-0.5 text-xs uppercase tracking-[0.16em] text-slate-400">
            {format(new Date(), "EEEE, MMMM d")}
          </p>
        </div>
        <Link href="/chat">
          <button className="inline-flex h-11 items-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 text-sm font-bold text-white shadow-lg shadow-indigo-200/60 transition-transform hover:scale-[1.02] active:scale-[0.98]">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            Create New Post
          </button>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {/* Total Posts */}
        <div className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-500 p-6 text-white shadow-xl shadow-indigo-200/50">
          <div className="pointer-events-none absolute right-3 top-3 opacity-[0.12] transition-opacity group-hover:opacity-[0.2]">
            <Zap className="h-24 w-24" fill="currentColor" />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-indigo-200/80">
            Total Posts
          </p>
          <div className="mt-3 flex items-end gap-2.5">
            <p className="text-5xl font-bold leading-none tracking-tight">{publishedCount}</p>
            {publishedCount > 0 && (
              <span className="mb-0.5 inline-flex items-center gap-1 rounded-lg bg-white/15 px-2 py-0.5 text-xs font-bold">
                <TrendingUp className="h-3 w-3" strokeWidth={3} /> +12%
              </span>
            )}
          </div>
          <p className="mt-5 text-xs font-medium tracking-wide text-indigo-200/70">
            {publishedCount > 0 ? "Most active in AI/Expert sector" : "No posts yet — create your first"}
          </p>
        </div>

        {/* Impressions */}
        <div className="rounded-3xl border border-slate-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
            Total Impressions
          </p>
          <div className="mt-3 flex items-end gap-2">
            <p className="text-5xl font-bold leading-none tracking-tight text-slate-900">
              {fmtNum(totalImpressions)}
            </p>
            {totalImpressions > 0 && (
              <span className="mb-0.5 inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-600">
                <TrendingUp className="h-3 w-3" strokeWidth={3} /> +24%
              </span>
            )}
          </div>
          <div className="mt-4 h-14">
            <MiniLine data={impressionVals} color="#6366f1" />
          </div>
        </div>

        {/* Likes */}
        <div className="rounded-3xl border border-slate-200/60 bg-white/80 p-5 shadow-sm backdrop-blur-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">
            Cumulative Likes
          </p>
          <div className="mt-3 flex items-end gap-2">
            <p className="text-5xl font-bold leading-none tracking-tight text-slate-900">
              {fmtNum(totalLikes)}
            </p>
            {totalLikes > 0 && (
              <span className="mb-0.5 inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-600">
                <TrendingUp className="h-3 w-3" strokeWidth={3} /> +8%
              </span>
            )}
          </div>
          <div className="mt-4 h-14">
            <MiniBars data={likeVals} color="#8b5cf6" />
          </div>
        </div>
      </div>

      {/* Bottom section */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Engagement Performance */}
        <div className="overflow-hidden rounded-3xl border border-slate-200/60 bg-white/80 shadow-sm backdrop-blur-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-7 py-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Engagement Performance</h2>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Real-time daily metrics
              </p>
            </div>
            <button className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
              Export PDF
            </button>
          </div>
          <div className="h-[260px] px-5 pb-5 pt-4">
            <MainLineChart data={impressionVals} />
          </div>
        </div>

        {/* Live Stream = Queue */}
        <div className="flex flex-col overflow-hidden rounded-3xl border border-slate-200/60 bg-white/80 shadow-sm backdrop-blur-sm">
          <div className="border-b border-slate-100 px-6 py-5">
            <h2 className="text-xl font-bold text-slate-900">Live Stream</h2>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Latest interactions
            </p>
          </div>

          {liveItems.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
              <p className="font-semibold text-slate-800">No posts yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Generate and publish your first post to see analytics here.
              </p>
              <Link href="/chat">
                <button className="mt-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:opacity-95">
                  Create your first post
                </button>
              </Link>
            </div>
          ) : (
            <>
              <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
                {liveItems.map((item) => {
                  const isLinkedIn = item.platform === "linkedin";
                  const dateStr = item.scheduled_at
                    ? format(new Date(item.scheduled_at), "MMM d, yyyy")
                    : format(new Date(item.created_at), "MMM d, yyyy");

                  return (
                    <li key={item.id} className="group px-5 py-4 transition hover:bg-slate-50/80">
                      <div className="flex gap-3">
                        <div
                          className={`mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm ${
                            isLinkedIn ? "bg-[#0077b5]" : "bg-slate-800"
                          }`}
                        >
                          <span className="text-[11px] font-black">{isLinkedIn ? "in" : "X"}</span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                            {dateStr}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-[13px] font-semibold leading-snug text-slate-800 group-hover:text-slate-900">
                            {item.content || "—"}
                          </p>
                          <div className="mt-2 flex items-center gap-3">
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                              <Heart className="h-3 w-3" /> 0
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                              <MessageCircle className="h-3 w-3" /> 0
                            </span>
                            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-indigo-500">
                              <Clock className="h-3 w-3" />
                              {item.status === "published" ? "Published" : "Scheduled"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="border-t border-slate-100 px-6 py-3.5">
                <Link href="/queue">
                  <button className="w-full text-center text-[11px] font-bold uppercase tracking-widest text-indigo-600 transition hover:text-indigo-700">
                    View All in Queue →
                  </button>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
