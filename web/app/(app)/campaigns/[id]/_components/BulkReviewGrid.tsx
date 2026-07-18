"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "@/components/spine/StatusBadge";
import { SUPPORTED_PLATFORMS } from "@/lib/constants/platforms";
import {
  selectionReducer,
  emptySelection,
  isPageFullySelected,
  progressFromCounts,
  type GridVariantRow,
} from "@/lib/campaigns/grid";
import type { CampaignHeader } from "@/lib/db/campaign-variants";
import { BulkActionBar } from "./BulkActionBar";
import { VariantDrawer } from "./VariantDrawer";

type Props = {
  campaignId: string;
  jobId?: string;
  header: CampaignHeader;
  initialRows: GridVariantRow[];
  initialTotal: number;
  pageSize: number;
};

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "in",
  x: "X",
};
const PLATFORM_TILE: Record<string, string> = {
  linkedin: "bg-[#0077b5]",
  x: "bg-slate-900",
};

function PlatformChip({ platform }: { platform: string }) {
  // Never hardcode the slug set — render only platforms in SUPPORTED_PLATFORMS,
  // fall back to a neutral chip for anything unexpected.
  const known = (SUPPORTED_PLATFORMS as readonly string[]).includes(platform);
  return (
    <span
      className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-black text-white ${
        known ? PLATFORM_TILE[platform] ?? "bg-slate-400" : "bg-slate-400"
      }`}
      title={platform}
    >
      {PLATFORM_LABEL[platform] ?? platform.charAt(0).toUpperCase()}
    </span>
  );
}

export function BulkReviewGrid({
  campaignId,
  jobId,
  header,
  initialRows,
  initialTotal,
  pageSize,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const statusFilter = searchParams.get("status") ?? "";
  const platformFilter = searchParams.get("platform") ?? "";
  const personaFilter = searchParams.get("persona_id") ?? "";
  const sortParam = searchParams.get("sort") ?? "";

  const [rows, setRows] = useState<GridVariantRow[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [counts, setCounts] = useState(header.counts);
  const [loading, setLoading] = useState(false);
  const [selection, dispatch] = useReducer(selectionReducer, emptySelection);
  const [inFlight, setInFlight] = useState(false);
  const [drawerVariantId, setDrawerVariantId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("page_size", String(pageSize));
    if (statusFilter) p.set("status", statusFilter);
    if (platformFilter) p.set("platform", platformFilter);
    if (personaFilter) p.set("persona_id", personaFilter);
    if (sortParam) p.set("sort", sortParam);
    return p.toString();
  }, [page, pageSize, statusFilter, platformFilter, personaFilter, sortParam]);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/variants?${buildQuery()}`);
      if (!res.ok) return;
      const data = await res.json();
      setRows(data.rows ?? []);
      setTotal(data.total ?? 0);
      if (data.counts) setCounts(data.counts);
    } finally {
      setLoading(false);
    }
  }, [campaignId, buildQuery]);

  // Refetch when the URL params change (filter/sort/page navigation).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data sync with the read route
    refetch();
  }, [refetch]);

  // Realtime: same subscription pattern as CampaignReview — campaign id filter
  // + campaign_personas campaign_id filter. On any change, refetch the current
  // page + header counts (covers variants streaming in during `generating`).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`bulk-review-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "campaign_personas",
          filter: `campaign_id=eq.${campaignId}`,
        },
        refetch
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "campaigns",
          filter: `id=eq.${campaignId}`,
        },
        refetch
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId, refetch]);

  const updateParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const p = new URLSearchParams(Array.from(searchParams.entries()));
      mutate(p);
      router.replace(`?${p.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  function setFilter(key: string, value: string) {
    updateParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      p.set("page", "1"); // reset paging when filters change
    });
  }

  function goToPage(next: number) {
    updateParams((p) => p.set("page", String(next)));
  }

  const pageIds = rows.map((r) => r.post_variant_id);
  const pageAllSelected = isPageFullySelected(selection, pageIds);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const progress = progressFromCounts(counts.approved, counts.total);
  const selectedIds = [...selection.ids];

  async function runBulk(
    path: string,
    body: Record<string, unknown>,
    label: string
  ) {
    if (selectedIds.length === 0) return;
    setInFlight(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_variant_ids: selectedIds, ...body }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setActionMsg(d.error ?? `${label} failed.`);
        return;
      }
      dispatch({ type: "clear" });
      await refetch();
      setActionMsg(`${label} done.`);
    } catch {
      setActionMsg(`${label} failed.`);
    } finally {
      setInFlight(false);
    }
  }

  function handleBulkApprove() {
    runBulk("bulk-approve", {}, "Approve");
  }

  function handleBulkRegenerate() {
    const instruction = window.prompt(
      "Regeneration instruction to apply to the selected posts:"
    );
    if (!instruction || !instruction.trim()) return;
    runBulk("bulk-regenerate", { instruction: instruction.trim() }, "Regenerate");
  }

  function handleBulkSchedule() {
    const input = window.prompt(
      "Schedule selected posts for (local datetime, e.g. 2026-07-20T09:00):"
    );
    if (!input) return;
    const iso = new Date(input).toISOString();
    if (new Date(iso) <= new Date()) {
      setActionMsg("Scheduled time must be in the future.");
      return;
    }
    runBulk("bulk-schedule", { scheduled_at: iso }, "Schedule");
  }

  return (
    <div className="space-y-4">
      {/* Header + progress */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            {header.campaign.title?.trim() || "Untitled campaign"}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {header.personas.length} account
            {header.personas.length !== 1 ? "s" : ""} ·{" "}
            <StatusBadge status={header.campaign.status} />
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-slate-900">
            {progress.approved} of {progress.total} approved
          </p>
          <div className="mt-1 h-2 w-40 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={platformFilter}
          onChange={(e) => setFilter("platform", e.target.value)}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
        >
          <option value="">All platforms</option>
          {SUPPORTED_PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={personaFilter}
          onChange={(e) => setFilter("persona_id", e.target.value)}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
        >
          <option value="">All accounts</option>
          {header.personas.map((p) => (
            <option key={p.persona_id} value={p.persona_id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setFilter("status", e.target.value)}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
        >
          <option value="">All statuses</option>
          {Object.keys(counts.byStatus).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={sortParam}
          onChange={(e) => setFilter("sort", e.target.value)}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
        >
          <option value="">Sort: account</option>
          <option value="status:asc">Sort: status</option>
          <option value="platform:asc">Sort: platform</option>
        </select>
        {loading && <span className="text-slate-400">Loading…</span>}
      </div>

      {actionMsg && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {actionMsg}
        </div>
      )}

      {/* Grid */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-[11px] font-semibold text-slate-500">
          <input
            type="checkbox"
            checked={pageAllSelected}
            onChange={() =>
              pageAllSelected
                ? dispatch({ type: "clear" })
                : dispatch({ type: "select-page", ids: pageIds })
            }
            className="h-3.5 w-3.5 rounded border-slate-300"
            aria-label="Select page"
          />
          <span>Select page</span>
          {total > pageIds.length && (
            <button
              type="button"
              onClick={async () => {
                // Select every row matching the active filters (may span pages).
                const p = new URLSearchParams(buildQuery());
                p.set("page", "1");
                p.set("page_size", String(total));
                const res = await fetch(
                  `/api/campaigns/${campaignId}/variants?${p.toString()}`
                );
                if (!res.ok) return;
                const data = await res.json();
                dispatch({
                  type: "select-all-matching",
                  ids: (data.rows ?? []).map((r: GridVariantRow) => r.post_variant_id),
                });
              }}
              className="text-indigo-600 hover:underline"
            >
              Select all {total} matching
            </button>
          )}
        </div>

        <ul className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <li className="px-4 py-10 text-center text-sm text-slate-400">
              No posts match these filters.
            </li>
          )}
          {rows.map((row) => {
            const selected = selection.ids.has(row.post_variant_id);
            return (
              <li
                key={row.post_variant_id}
                className={`flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50/60 ${
                  selected ? "bg-indigo-50/40" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() =>
                    dispatch({ type: "toggle", id: row.post_variant_id })
                  }
                  className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                  aria-label={`Select ${row.persona_name}`}
                />
                <div
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: row.avatar_color }}
                >
                  {row.persona_name.charAt(0).toUpperCase()}
                </div>
                <div className="w-32 shrink-0">
                  <p className="truncate text-xs font-semibold text-slate-800">
                    {row.persona_name}
                  </p>
                </div>
                <PlatformChip platform={row.platform} />
                <button
                  type="button"
                  onClick={() => setDrawerVariantId(row.post_variant_id)}
                  className="min-w-0 flex-1 truncate text-left text-xs text-slate-500 hover:text-slate-800"
                  title="Open to review / edit"
                >
                  {row.body_preview || "—"}
                </button>
                <StatusBadge status={row.status} />
                <button
                  type="button"
                  onClick={() => setDrawerVariantId(row.post_variant_id)}
                  className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
                >
                  Review
                </button>
              </li>
            );
          })}
        </ul>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-500">
          <span>
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
              className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 transition hover:border-indigo-300 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 transition hover:border-indigo-300 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <BulkActionBar
        selectedCount={selection.ids.size}
        inFlight={inFlight}
        onApprove={handleBulkApprove}
        onRegenerate={handleBulkRegenerate}
        onSchedule={handleBulkSchedule}
        onClear={() => dispatch({ type: "clear" })}
      />

      <VariantDrawer
        campaignId={campaignId}
        variantId={drawerVariantId}
        jobId={jobId}
        onClose={() => setDrawerVariantId(null)}
      />
    </div>
  );
}
