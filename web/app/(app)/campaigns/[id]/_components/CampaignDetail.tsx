"use client";

import { useCallback, useEffect, useState } from "react";
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

export function CampaignDetail({ initial }: Props) {
  const [campaign, setCampaign] = useState<CampaignWithPersonas>(initial);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const fresh = await fetchCampaign(initial.id);
    if (fresh) setCampaign(fresh);
  }, [initial.id]);

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
  const isGenerating = campaign.status === "generating";

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
        </div>
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
      </div>

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
