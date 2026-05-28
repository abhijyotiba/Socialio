import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";
import {
  Plus,
  Zap,
  Eye,
  Heart,
  Clock,
  ArrowRight,
  LayoutDashboard,
  CalendarClock,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPersonasForWorkspace, getPersona } from "@/lib/db/personas";
import {
  listPublishedVariantsWithMetrics,
  listScheduledVariants,
  type PublishedVariantWithMetrics,
  type ScheduledVariantRow,
} from "@/lib/db/posts";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type PostMetrics = NonNullable<PublishedVariantWithMetrics["post_metrics"]>;

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

// `gradientId` must be unique within the rendered page. Caller passes a stable
// string (no useId needed; component is server-rendered).
function LineChart({ data, gradientId }: { data: number[]; gradientId: string }) {
  const W = 560;
  const H = 180;
  const padL = 40;
  const padR = 12;
  const padT = 10;
  const padB = 28;
  const cW = W - padL - padR;
  const cH = H - padT - padB;
  const max = Math.max(...data, 1);

  const pts = data.map((v, i) => ({
    x: padL + (i / (data.length - 1)) * cW,
    y: padT + (1 - v / max) * cH,
  }));

  const line = smoothPath(pts);
  const area = `${line} L ${pts[pts.length - 1].x},${padT + cH} L ${pts[0].x},${padT + cH} Z`;

  const tickCount = 3;
  const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const val = Math.round((max / tickCount) * (tickCount - i));
    return { val, y: padT + (i / tickCount) * cH };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </linearGradient>
      </defs>

      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#f1f5f9" strokeWidth="1" />
          <text x={padL - 8} y={t.y + 4} textAnchor="end" fontSize="9" fill="#94a3b8">
            {t.val >= 1000 ? `${(t.val / 1000).toFixed(0)}k` : t.val}
          </text>
        </g>
      ))}

      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3" fill="#fff" stroke="#6366f1" strokeWidth="1.5" />
      ))}

      {DAYS.map((d, i) => (
        <text
          key={d}
          x={padL + (i / (DAYS.length - 1)) * cW}
          y={H - 6}
          textAnchor="middle"
          fontSize="9"
          fill="#94a3b8"
        >
          {d}
        </text>
      ))}
    </svg>
  );
}

function MiniSparkline({
  data,
  color,
  gradientId,
}: {
  data: number[];
  color: string;
  gradientId: string;
}) {
  const W = 100;
  const H = 36;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: (1 - v / max) * H,
  }));
  const line = smoothPath(pts);
  const area = `${line} L ${W},${H} L 0,${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatQueueDate(item: ScheduledVariantRow): string {
  const date = item.scheduled_at
    ? new Date(item.scheduled_at)
    : new Date(item.created_at);
  if (isToday(date)) return `Today · ${format(date, "h:mm a")}`;
  if (isTomorrow(date)) return `Tomorrow · ${format(date, "h:mm a")}`;
  return format(date, "MMM d · h:mm a");
}

function PlatformIcon({ platform, size = "sm" }: { platform: string; size?: "sm" | "xs" }) {
  const dim = size === "xs" ? "h-7 w-7" : "h-9 w-9";
  const iconDim = size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4";

  if (platform === "linkedin") {
    return (
      <div className={`flex ${dim} shrink-0 items-center justify-center rounded-lg bg-[#0077b5]`}>
        <svg className={`${iconDim} text-white`} viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      </div>
    );
  }
  return (
    <div className={`flex ${dim} shrink-0 items-center justify-center rounded-lg bg-slate-900`}>
      <svg className={`${iconDim} text-white`} viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    </div>
  );
}

function getMetric(m: PostMetrics | null): PostMetrics | null {
  return m;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ persona_id?: string }>;
}) {
  const { persona_id: activePersonaId } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/onboarding");

  // Validate persona scoping when filtering. Silently fall back to "all" on
  // mismatch — the UI just stops filtering rather than throwing in the user's
  // face.
  let validPersonaId: string | undefined;
  if (activePersonaId) {
    const persona = await getPersona(activePersonaId);
    if (persona && persona.workspace_id === workspace.workspace_id) {
      validPersonaId = activePersonaId;
    }
  }

  const [metrics, queue, personas] = await Promise.all([
    listPublishedVariantsWithMetrics(validPersonaId),
    listScheduledVariants(),
    getPersonasForWorkspace(workspace.workspace_id),
  ]);

  const publishedCount = metrics.length;
  const totalImpressions = metrics.reduce(
    (acc, v) => acc + (getMetric(v.post_metrics)?.impressions ?? 0),
    0
  );
  const totalLikes = metrics.reduce(
    (acc, v) => acc + (getMetric(v.post_metrics)?.likes ?? 0),
    0
  );

  const hasRealData = totalImpressions > 0 || totalLikes > 0;
  const impressionVals = metrics
    .slice(0, 7)
    .map((v) => getMetric(v.post_metrics)?.impressions ?? 0);
  const likeVals = metrics
    .slice(0, 7)
    .map((v) => getMetric(v.post_metrics)?.likes ?? 0);

  const queueItems = queue.slice(0, 4);
  const queueCount = queue.length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 pb-10 page-enter">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Overview</h1>
            <p className="text-xs text-slate-400">
              {format(new Date(), "EEEE, MMMM d")} · last 7 days
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

      {/* ── Persona filter ──────────────────────────────────── */}
      {personas.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            View
          </span>
          <Link
            href="/dashboard"
            scroll={false}
            className={`inline-flex h-7 items-center rounded-full px-3 text-[11px] font-semibold transition ${
              !validPersonaId
                ? "bg-slate-900 text-white shadow-sm"
                : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
            }`}
          >
            All personas
          </Link>
          {personas.map((p) => {
            const active = validPersonaId === p.id;
            return (
              <Link
                key={p.id}
                href={`/dashboard?persona_id=${encodeURIComponent(p.id)}`}
                scroll={false}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition ${
                  active
                    ? "text-white shadow-sm"
                    : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
                }`}
                style={active ? { backgroundColor: p.avatar_color } : undefined}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: active ? "#ffffff" : p.avatar_color }}
                />
                {p.name}
              </Link>
            );
          })}
        </div>
      )}

      {/* ── Stat cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 stagger-children">

        {/* Posts published */}
        <div className="animate-fade-up card-lift relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-indigo-500 p-5 text-white shadow-lg shadow-indigo-200/50">
          <div className="pointer-events-none absolute right-2 top-1 opacity-[0.10]">
            <Zap className="h-16 w-16" fill="currentColor" />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-indigo-200/80">
            Posts Published
          </p>
          <div className="mt-3 flex items-end gap-2">
            <p className="text-4xl font-bold leading-none tracking-tight">{publishedCount}</p>
          </div>
          <p className="mt-3 text-[11px] text-indigo-200/70">
            {publishedCount > 0 ? "All-time total across platforms" : "No posts yet — create your first"}
          </p>
        </div>

        {/* Impressions */}
        <div className="animate-fade-up card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                Impressions
              </p>
              <div className="mt-2 flex items-end gap-2">
                <p className="text-4xl font-bold leading-none tracking-tight text-slate-900">
                  {fmtNum(totalImpressions)}
                </p>
              </div>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
              <Eye className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 h-9">
            <MiniSparkline data={impressionVals} color="#6366f1" gradientId="sp-impressions" />
          </div>
        </div>

        {/* Likes */}
        <div className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                Total Likes
              </p>
              <div className="mt-2 flex items-end gap-2">
                <p className="text-4xl font-bold leading-none tracking-tight text-slate-900">
                  {fmtNum(totalLikes)}
                </p>
              </div>
            </div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-500">
              <Heart className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 h-9">
            <MiniSparkline data={likeVals} color="#8b5cf6" gradientId="sp-likes" />
          </div>
        </div>
      </div>

      {/* ── Bottom row ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">

        {/* Engagement chart — takes 3 cols */}
        <div className="card-lift overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm lg:col-span-3">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Engagement Performance</h2>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Impressions across your last published posts
              </p>
            </div>
          </div>
          <div className="h-[200px] px-3 pb-3 pt-2">
            {hasRealData ? (
              <LineChart data={impressionVals} gradientId="lc-engagement" />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <p className="text-xs font-semibold text-slate-700">No metrics yet</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Publish a post and platform metrics will appear here after
                  the next sync.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Queue preview — takes 2 cols */}
        <div className="card-lift flex flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-indigo-500" />
              <h2 className="text-sm font-bold text-slate-900">Upcoming Queue</h2>
            </div>
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
              {queueCount}
            </span>
          </div>

          {queueItems.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-5 py-10 text-center">
              <div className="relative mb-4">
                <div className="absolute inset-0 rounded-2xl bg-indigo-400/15 blur-xl scale-150" />
                <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-400/30">
                  <CalendarClock className="h-6 w-6 text-white" />
                </div>
              </div>
              <p className="text-xs font-bold text-slate-700">Queue is empty</p>
              <p className="mt-1 text-[11px] text-slate-400">
                Generate content to fill your pipeline.
              </p>
              <Link href="/chat">
                <button className="mt-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 active:scale-[0.97]">
                  Create post
                </button>
              </Link>
            </div>
          ) : (
            <>
              <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
                {queueItems.map((item) => (
                  <li key={item.id} className="flex items-start gap-3 px-5 py-3.5 transition hover:bg-slate-50/70">
                    <PlatformIcon platform={item.platform} size="xs" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-800">
                        {item.body || "—"}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-indigo-400" />
                        <span className="text-[11px] font-medium text-slate-500">
                          {item.scheduled_at
                            ? formatQueueDate(item)
                            : "Not scheduled"}
                        </span>
                      </div>
                    </div>
                    {item.scheduled_at && (
                      <span className="mt-0.5 shrink-0 text-[10px] font-medium text-slate-400">
                        {formatDistanceToNow(new Date(item.scheduled_at), { addSuffix: true })}
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              <div className="border-t border-slate-100 px-5 py-3">
                <Link href="/queue" className="flex items-center justify-between text-[11px] font-semibold text-indigo-600 transition hover:text-indigo-700">
                  View full queue
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Recent posts row ────────────────────────────────── */}
      {publishedCount > 0 && (
        <div className="rounded-2xl border border-slate-200/70 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-bold text-slate-900">Recent Posts</h2>
            <span className="text-[11px] text-slate-400">{publishedCount} total</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {metrics.slice(0, 4).map((v) => {
              const m = getMetric(v.post_metrics);
              return (
                <li key={v.id} className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-slate-50/70">
                  <PlatformIcon platform={v.platform} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-500">
                      {v.published_at ? format(new Date(v.published_at), "MMM d, yyyy") : "—"}
                    </p>
                  </div>
                  <div className="flex items-center gap-5 shrink-0">
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-900">{fmtNum(m?.impressions ?? 0)}</p>
                      <p className="text-[10px] text-slate-400">impressions</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-slate-900">{fmtNum(m?.likes ?? 0)}</p>
                      <p className="text-[10px] text-slate-400">likes</p>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="text-xs font-bold text-slate-900">{fmtNum(m?.comments ?? 0)}</p>
                      <p className="text-[10px] text-slate-400">comments</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
