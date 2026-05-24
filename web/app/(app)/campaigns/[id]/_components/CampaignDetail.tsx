"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { CampaignWithPersonas } from "@/lib/db/campaigns";

type Props = { initial: CampaignWithPersonas };

async function fetchCampaign(id: string): Promise<CampaignWithPersonas | null> {
  const res = await fetch(`/api/campaigns/${id}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.campaign as CampaignWithPersonas | null;
}

const STATUS_LABEL: Record<string, string> = {
  generating: "Generating",
  pending_approval: "Needs approval",
  generation_partial: "Some failed",
  approved: "Approved",
  failed: "Failed",
};

const STATUS_TONE: Record<string, string> = {
  generating: "bg-slate-100 text-slate-700",
  pending_approval: "bg-amber-50 text-amber-700",
  generation_partial: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
};

const LIVE_STATUSES = new Set(["scheduled", "publishing", "published"]);

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

// Renders date/time strings that depend on the user's locale or wall clock.
// On the server pass we render nothing — the locale-formatted title and the
// relative-time string would otherwise hydrate-mismatch (server in en-US,
// browser in en-GB, etc.). After mount, we render the real values.
function ClientDate({
  iso,
  render,
}: {
  iso: string;
  render: (date: Date) => { label: string; tooltip: string };
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) {
    return <span suppressHydrationWarning>&nbsp;</span>;
  }
  const { label, tooltip } = render(new Date(iso));
  return <span title={tooltip}>{label}</span>;
}

export function CampaignDetail({ initial }: Props) {
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
    variantStatusCounts.scheduled +
      variantStatusCounts.publishing +
      variantStatusCounts.published >
    0;
  const hasPublishedOrPublishing =
    variantStatusCounts.publishing + variantStatusCounts.published > 0;
  const canCancelScheduled =
    variantStatusCounts.scheduled > 0 && variantStatusCounts.publishing === 0;

  // A campaign whose worker crashed or got killed before producing any
  // variants stays in 'generating' forever. After ~5 minutes with no
  // variants written, treat it as stuck and let the user delete it.
  const isGeneratingNow = campaign.status === "generating";
  const generatingStuck =
    isGeneratingNow &&
    campaign.campaign_personas.every(cp => cp.variants.length === 0) &&
    !!campaign.generation_started_at &&
    Date.now() - new Date(campaign.generation_started_at).getTime() > 5 * 60_000;
  const canDelete =
    !hasLiveVariants && (!isGeneratingNow || generatingStuck);

  const generationDurationMs = useMemo(() => {
    if (!campaign.generation_started_at) return null;
    // Use updated_at as the proxy "generation finished" timestamp. It's
    // refreshed by the trigger on every campaign row update, including the
    // status flip to pending_approval/approved/failed.
    const start = new Date(campaign.generation_started_at).getTime();
    const end = new Date(campaign.updated_at).getTime();
    if (end <= start) return null;
    return end - start;
  }, [campaign.generation_started_at, campaign.updated_at]);

  async function handleDelete() {
    if (!canDelete) return;
    const confirmed = window.confirm(
      "Delete this campaign? Generated drafts will be removed. This cannot be undone."
    );
    if (!confirmed) return;
    setPendingAction("delete");
    setDeleteError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/campaigns");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setDeleteError(body.error ?? "Could not delete this campaign.");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleCancelScheduled() {
    if (!canCancelScheduled) return;
    const count = variantStatusCounts.scheduled;
    const confirmed = window.confirm(
      `Cancel ${count} scheduled ${count === 1 ? "post" : "posts"}? ` +
        "They will not be published. You can then delete the campaign."
    );
    if (!confirmed) return;
    setPendingAction("cancel-scheduled");
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/campaigns/${campaign.id}/cancel-scheduled`,
        { method: "POST" }
      );
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

  // Realtime: any update to campaign_personas (status, generation_error,
  // approval) triggers a refetch. Cheaper than reconciling row-by-row.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`campaign-detail-${initial.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "campaign_personas",
          filter: `campaign_id=eq.${initial.id}`,
        },
        refresh
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "campaigns",
          filter: `id=eq.${initial.id}`,
        },
        refresh
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [initial.id, refresh]);

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
      await fetch(
        `/api/campaigns/${campaign.id}/persona/${personaId}/approve`,
        { method: "POST" }
      );
      await refresh();
    } finally {
      setPendingAction(null);
    }
  }

  async function rejectPersona(personaId: string) {
    setPendingAction(`reject-${personaId}`);
    try {
      await fetch(`/api/campaigns/${campaign.id}/persona/${personaId}/reject`, {
        method: "POST",
      });
      await refresh();
    } finally {
      setPendingAction(null);
    }
  }

  const pendingPersonas = campaign.campaign_personas.filter(
    (cp) => cp.approval_status === "pending"
  );
  const isGenerating = isGeneratingNow;

  const sourceJob = campaign.ingestion_job;
  const sourceUrl = sourceJob?.source_url ?? null;
  const sourcePreview =
    sourceJob?.source_type === "text" && sourceJob.source_text
      ? sourceJob.source_text.slice(0, 140) +
        (sourceJob.source_text.length > 140 ? "…" : "")
      : null;

  const createdAtIso = campaign.created_at;
  const updatedAtIso = campaign.updated_at;
  const showUpdatedAt =
    new Date(updatedAtIso).getTime() - new Date(createdAtIso).getTime() > 60_000;

  const deleteTooltip =
    isGenerating && !generatingStuck
      ? "Wait for generation to finish before deleting."
      : hasPublishedOrPublishing
      ? "This campaign has variants that are publishing or already published. They cannot be deleted."
      : variantStatusCounts.scheduled > 0
      ? "Cancel the scheduled posts first, then delete."
      : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            {campaign.title?.trim() || "Untitled campaign"}
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            {campaign.campaign_personas.length} persona
            {campaign.campaign_personas.length !== 1 ? "s" : ""}
            {" · "}
            <span
              className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${
                STATUS_TONE[campaign.status] ?? "bg-slate-100 text-slate-700"
              }`}
            >
              {STATUS_LABEL[campaign.status] ?? campaign.status}
            </span>
          </p>
          {campaign.user_angle && (
            <p className="mt-2 text-xs text-slate-500">
              <span className="font-semibold text-slate-600">Angle:</span>{" "}
              {campaign.user_angle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pendingPersonas.length > 0 && !isGenerating && (
            <button
              type="button"
              onClick={approveAll}
              disabled={pendingAction !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {pendingAction === "all"
                ? "Approving…"
                : `Approve all (${pendingPersonas.length})`}
            </button>
          )}
          {canCancelScheduled && (
            <button
              type="button"
              onClick={handleCancelScheduled}
              disabled={pendingAction !== null}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 disabled:opacity-50"
            >
              {pendingAction === "cancel-scheduled"
                ? "Cancelling…"
                : `Cancel scheduled (${variantStatusCounts.scheduled})`}
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

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-slate-200/70 bg-white px-4 py-3 text-[11px] sm:grid-cols-4">
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-400">Created</dt>
          <dd className="mt-0.5 text-slate-700">
            <ClientDate
              iso={createdAtIso}
              render={d => ({
                label: relativeTime(d.toISOString()),
                tooltip: d.toLocaleString(),
              })}
            />
          </dd>
        </div>
        {showUpdatedAt && (
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Updated</dt>
            <dd className="mt-0.5 text-slate-700">
              <ClientDate
                iso={updatedAtIso}
                render={d => ({
                  label: relativeTime(d.toISOString()),
                  tooltip: d.toLocaleString(),
                })}
              />
            </dd>
          </div>
        )}
        {generationDurationMs !== null && (
          <div>
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Generation</dt>
            <dd className="mt-0.5 text-slate-700">
              {formatDuration(generationDurationMs)}
            </dd>
          </div>
        )}
        <div>
          <dt className="font-semibold uppercase tracking-wide text-slate-400">ID</dt>
          <dd className="mt-0.5 font-mono text-[10px] text-slate-500" title={campaign.id}>
            {campaign.id.slice(0, 8)}
          </dd>
        </div>
        {(sourceUrl || sourcePreview) && (
          <div className="col-span-2 sm:col-span-4">
            <dt className="font-semibold uppercase tracking-wide text-slate-400">Source</dt>
            <dd className="mt-0.5 text-slate-700">
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="break-all text-indigo-600 hover:underline"
                >
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
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {deleteError}
        </div>
      )}

      {campaign.failure_reason && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-xs font-semibold text-red-700">
            Campaign failed
            {campaign.failure_code ? ` · ${campaign.failure_code}` : ""}
          </p>
          <p className="mt-1 text-xs text-red-600">{campaign.failure_reason}</p>
        </div>
      )}

      <ul className="space-y-3">
        {campaign.campaign_personas.map((cp) => {
          const approveBusy = pendingAction === `approve-${cp.persona.id}`;
          const rejectBusy = pendingAction === `reject-${cp.persona.id}`;
          const lockedOut = pendingAction !== null;

          // PostgREST returns the brand_configs join as an array even when
          // there's a UNIQUE constraint; tolerate either shape.
          const bc = cp.persona.brand_configs;
          const currentPromptVersion = Array.isArray(bc)
            ? bc[0]?.current_prompt_version_id ?? null
            : bc?.current_prompt_version_id ?? null;
          // Voice has changed if every variant was generated under a prompt
          // version that no longer matches the persona's current one.
          const voiceChanged =
            currentPromptVersion !== null &&
            cp.variants.length > 0 &&
            cp.variants.every(
              (v) =>
                v.prompt_version_id !== null &&
                v.prompt_version_id !== currentPromptVersion
            );

          return (
            <li
              key={cp.id}
              className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: cp.persona.avatar_color }}
                  >
                    {cp.persona.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {cp.persona.name}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {cp.variants.length} variant
                      {cp.variants.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>

                {cp.approval_status === "pending" &&
                  !isGenerating &&
                  cp.variants.length > 0 && (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => rejectPersona(cp.persona.id)}
                        disabled={lockedOut}
                        className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-400 disabled:opacity-50"
                      >
                        {rejectBusy ? "Rejecting…" : "Reject"}
                      </button>
                      <button
                        type="button"
                        onClick={() => approvePersona(cp.persona.id)}
                        disabled={lockedOut}
                        className="inline-flex h-8 items-center rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {approveBusy ? "Approving…" : "Approve"}
                      </button>
                    </div>
                  )}

                {cp.approval_status === "approved" && (
                  <span className="text-xs font-semibold text-emerald-600">
                    ✓ Approved
                  </span>
                )}
                {cp.approval_status === "rejected" && (
                  <span className="text-xs text-slate-400">Rejected</span>
                )}
              </div>

              {voiceChanged && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  This persona&apos;s voice profile has been updated since
                  these variants were generated. Regenerate if you want the
                  latest voice.
                </div>
              )}

              {isGenerating && cp.variants.length === 0 && (
                <p className="text-xs text-slate-400">Generating…</p>
              )}

              {cp.generation_error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                  {cp.generation_error}
                </p>
              )}

              <div className="space-y-2">
                {cp.variants.map((v) => {
                  // PostgREST sometimes embeds the joined post_variants as a
                  // nested object rather than flattening; tolerate both.
                  const nested = (v as unknown as { post_variants?: { body?: string } }).post_variants;
                  const body = v.body ?? nested?.body ?? "";
                  return (
                    <div
                      key={v.id}
                      className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700"
                    >
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        {v.platform}
                      </p>
                      <p className="whitespace-pre-wrap leading-relaxed">{body}</p>
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
