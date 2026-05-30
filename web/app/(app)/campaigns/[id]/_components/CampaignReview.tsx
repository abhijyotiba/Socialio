"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { StatusBadge } from "@/components/spine/StatusBadge";
import { PersonaGroup } from "./PersonaGroup";
import { createNowStore } from "@/lib/hooks/now-store";
import type { CampaignWithPersonas } from "@/lib/db/campaigns";

type Props = { initial: CampaignWithPersonas };

async function fetchCampaign(id: string): Promise<CampaignWithPersonas | null> {
  const res = await fetch(`/api/campaigns/${id}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.campaign as CampaignWithPersonas | null;
}

const NOW_POLL_INTERVAL_MS = 60_000;

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function useNowMs() {
  // Create the store once per component instance (stable across renders). Its
  // getSnapshot returns a cached value (stable between ticks) — a fresh
  // Date.now() per call would make useSyncExternalStore re-render every frame
  // ("Maximum update depth exceeded").
  const store = useMemo(() => createNowStore(NOW_POLL_INTERVAL_MS), []);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
}

function ClientDate({ iso, render }: { iso: string; render: (date: Date) => { label: string; tooltip: string } }) {
  const nowMs = useNowMs();
  if (!nowMs) return <span suppressHydrationWarning>&nbsp;</span>;
  const { label, tooltip } = render(new Date(iso));
  return <span title={tooltip}>{label}</span>;
}

export function CampaignReview({ initial }: Props) {
  const router = useRouter();
  const [campaign, setCampaign] = useState<CampaignWithPersonas>(initial);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const fresh = await fetchCampaign(initial.id);
    if (fresh) setCampaign(fresh);
  }, [initial.id]);

  const variantStatusCounts = useMemo(() => {
    const counts = { scheduled: 0, publishing: 0, published: 0 };
    for (const cp of campaign.campaign_personas) {
      for (const v of cp.variants) {
        if (v.status === "scheduled") counts.scheduled++;
        else if (v.status === "publishing") counts.publishing++;
        else if (v.status === "published") counts.published++;
      }
    }
    return counts;
  }, [campaign]);

  const hasLiveVariants =
    variantStatusCounts.scheduled + variantStatusCounts.publishing + variantStatusCounts.published > 0;
  const hasPublishedOrPublishing = variantStatusCounts.publishing + variantStatusCounts.published > 0;
  const canCancelScheduled = variantStatusCounts.scheduled > 0 && variantStatusCounts.publishing === 0;

  const nowMs = useNowMs();
  const isGeneratingNow = campaign.status === "generating";
  const generatingStuck =
    isGeneratingNow &&
    campaign.campaign_personas.every((cp) => cp.variants.length === 0) &&
    !!campaign.generation_started_at &&
    nowMs > 0 &&
    nowMs - new Date(campaign.generation_started_at).getTime() > 5 * 60_000;
  const canDelete = !hasLiveVariants && (!isGeneratingNow || generatingStuck);

  const generationDurationMs = useMemo(() => {
    if (!campaign.generation_started_at) return null;
    const start = new Date(campaign.generation_started_at).getTime();
    const end = new Date(campaign.updated_at).getTime();
    if (end <= start) return null;
    return end - start;
  }, [campaign.generation_started_at, campaign.updated_at]);

  // Realtime: refetch on any campaign or campaign_persona update
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`campaign-review-${initial.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "campaign_personas", filter: `campaign_id=eq.${initial.id}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "campaigns", filter: `id=eq.${initial.id}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [initial.id, refresh]);

  async function handleDelete() {
    if (!canDelete) return;
    const confirmed = window.confirm("Delete this campaign? Generated drafts will be removed. This cannot be undone.");
    if (!confirmed) return;
    setPendingAction("delete");
    setDeleteError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
      if (res.ok) { router.push("/campaigns"); router.refresh(); return; }
      const body = await res.json().catch(() => ({}));
      setDeleteError(body.error ?? "Could not delete this campaign.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCancelScheduled() {
    if (!canCancelScheduled) return;
    const count = variantStatusCounts.scheduled;
    const confirmed = window.confirm(`Cancel ${count} scheduled ${count === 1 ? "post" : "posts"}? They will not be published.`);
    if (!confirmed) return;
    setPendingAction("cancel-scheduled");
    setDeleteError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/cancel-scheduled`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleteError(body.error ?? "Could not cancel scheduled posts.");
        return;
      }
      await refresh();
    } finally {
      setPendingAction(null);
    }
  }

  async function approveAll() {
    setPendingAction("all");
    try {
      await fetch(`/api/campaigns/${campaign.id}/approve`, { method: "POST" });
      await refresh();
    } finally {
      setPendingAction(null);
    }
  }

  async function approvePersona(personaId: string) {
    setPendingAction(`approve-${personaId}`);
    try {
      await fetch(`/api/campaigns/${campaign.id}/persona/${personaId}/approve`, { method: "POST" });
      await refresh();
    } finally {
      setPendingAction(null);
    }
  }

  async function rejectPersona(personaId: string) {
    setPendingAction(`reject-${personaId}`);
    try {
      await fetch(`/api/campaigns/${campaign.id}/persona/${personaId}/reject`, { method: "POST" });
      await refresh();
    } finally {
      setPendingAction(null);
    }
  }

  const pendingPersonas = campaign.campaign_personas.filter((cp) => cp.approval_status === "pending");

  const sourceJob = campaign.ingestion_job;
  const sourceUrl = sourceJob?.source_url ?? null;
  const sourcePreview =
    sourceJob?.source_type === "text" && sourceJob.source_text
      ? sourceJob.source_text.slice(0, 140) + (sourceJob.source_text.length > 140 ? "…" : "")
      : null;

  const createdAtIso = campaign.created_at;
  const updatedAtIso = campaign.updated_at;
  const showUpdatedAt = new Date(updatedAtIso).getTime() - new Date(createdAtIso).getTime() > 60_000;

  const deleteTooltip =
    isGeneratingNow && !generatingStuck
      ? "Wait for generation to finish before deleting."
      : hasPublishedOrPublishing
      ? "This campaign has variants that are publishing or already published."
      : variantStatusCounts.scheduled > 0
      ? "Cancel the scheduled posts first, then delete."
      : "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            {campaign.title?.trim() || "Untitled campaign"}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {campaign.campaign_personas.length} persona{campaign.campaign_personas.length !== 1 ? "s" : ""}
            {" · "}
            <StatusBadge status={campaign.status} />
          </p>
          {campaign.user_angle && (
            <p className="mt-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-600">Angle:</span> {campaign.user_angle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pendingPersonas.length > 0 && !isGeneratingNow && (
            <button
              type="button"
              onClick={approveAll}
              disabled={pendingAction !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {pendingAction === "all" ? "Approving…" : `Approve all (${pendingPersonas.length})`}
            </button>
          )}
          {canCancelScheduled && (
            <button
              type="button"
              onClick={handleCancelScheduled}
              disabled={pendingAction !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50"
            >
              {pendingAction === "cancel-scheduled" ? "Cancelling…" : `Cancel scheduled (${variantStatusCounts.scheduled})`}
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canDelete || pendingAction !== null}
            title={deleteTooltip || undefined}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-600"
          >
            {pendingAction === "delete" ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>

      {/* Metadata strip */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-slate-200/70 bg-white px-4 py-3 text-[11px] sm:grid-cols-4">
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-400">Created</dt>
          <dd className="mt-0.5 text-slate-700">
            <ClientDate iso={createdAtIso} render={(d) => ({ label: relativeTime(d.toISOString()), tooltip: d.toLocaleString() })} />
          </dd>
        </div>
        {showUpdatedAt && (
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Updated</dt>
            <dd className="mt-0.5 text-slate-700">
              <ClientDate iso={updatedAtIso} render={(d) => ({ label: relativeTime(d.toISOString()), tooltip: d.toLocaleString() })} />
            </dd>
          </div>
        )}
        {generationDurationMs !== null && (
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Generation</dt>
            <dd className="mt-0.5 text-slate-700">{formatDuration(generationDurationMs)}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-400">ID</dt>
          <dd className="mt-0.5 font-mono text-[10px] text-slate-500" title={campaign.id}>{campaign.id.slice(0, 8)}</dd>
        </div>
        {(sourceUrl || sourcePreview) && (
          <div className="col-span-2 sm:col-span-4">
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Source</dt>
            <dd className="mt-0.5 text-slate-700">
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noreferrer noopener" className="break-all text-indigo-600 hover:underline">
                  {sourceJob?.extracted_title?.trim() || sourceUrl}
                </a>
              ) : (
                <span className="italic text-slate-500">{sourcePreview}</span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {deleteError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{deleteError}</div>
      )}

      {campaign.failure_reason && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold text-red-700">
            Campaign failed{campaign.failure_code ? ` · ${campaign.failure_code}` : ""}
          </p>
          <p className="mt-1 text-xs text-red-600">{campaign.failure_reason}</p>
        </div>
      )}

      {/* Persona groups — each now renders actionable VariantCards */}
      <ul className="space-y-3">
        {campaign.campaign_personas.map((cp) => {
          const bc = cp.persona.brand_configs;
          const currentPromptVersion = Array.isArray(bc)
            ? bc[0]?.current_prompt_version_id ?? null
            : bc?.current_prompt_version_id ?? null;
          const voiceChanged =
            currentPromptVersion !== null &&
            cp.variants.length > 0 &&
            cp.variants.every(
              (v) => v.prompt_version_id !== null && v.prompt_version_id !== currentPromptVersion
            );
          return (
            <PersonaGroup
              key={cp.id}
              cp={cp}
              jobId={campaign.ingestion_job_id ?? undefined}
              isGenerating={isGeneratingNow}
              pendingAction={pendingAction}
              voiceChanged={voiceChanged}
              onApprove={approvePersona}
              onReject={rejectPersona}
            />
          );
        })}
      </ul>
    </div>
  );
}
