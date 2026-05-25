"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CampaignWithPersonas } from "@/lib/db/campaigns";
import { TypingIndicator } from "./TypingIndicator";

type Props = { campaignId: string };

async function fetchCampaign(campaignId: string): Promise<CampaignWithPersonas | null> {
  const res = await fetch(`/api/campaigns/${campaignId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.campaign as CampaignWithPersonas | null;
}

export function CampaignBatchCard({ campaignId }: Props) {
  const [campaign, setCampaign] = useState<CampaignWithPersonas | null>(null);
  const [approving, setApproving] = useState<string | null>(null);

  useEffect(() => {
    fetchCampaign(campaignId).then(setCampaign);

    const supabase = createClient();
    const channel = supabase
      .channel(`campaign-${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "campaign_personas",
          filter: `campaign_id=eq.${campaignId}`,
        },
        () => {
          fetchCampaign(campaignId).then(setCampaign);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "campaigns",
          filter: `id=eq.${campaignId}`,
        },
        () => {
          fetchCampaign(campaignId).then(setCampaign);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  async function approveAll() {
    setApproving("all");
    try {
      await fetch(`/api/campaigns/${campaignId}/approve`, { method: "POST" });
      setCampaign(await fetchCampaign(campaignId));
    } finally {
      setApproving(null);
    }
  }

  async function approvePersona(personaId: string) {
    setApproving(personaId);
    try {
      await fetch(`/api/campaigns/${campaignId}/persona/${personaId}/approve`, { method: "POST" });
      setCampaign(await fetchCampaign(campaignId));
    } finally {
      setApproving(null);
    }
  }

  async function rejectPersona(personaId: string) {
    setApproving(`reject-${personaId}`);
    try {
      await fetch(`/api/campaigns/${campaignId}/persona/${personaId}/reject`, { method: "POST" });
      setCampaign(await fetchCampaign(campaignId));
    } finally {
      setApproving(null);
    }
  }

  if (!campaign) return <TypingIndicator label="Loading campaign…" />;

  const isGenerating = campaign.status === "generating";
  const pendingPersonas = campaign.campaign_personas.filter(
    (cp) => cp.approval_status === "pending"
  );

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm space-y-4 max-w-2xl animate-message-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">{campaign.title ?? "Campaign"}</p>
          <p className="text-[11px] text-slate-400">
            {campaign.campaign_personas.length} persona
            {campaign.campaign_personas.length !== 1 ? "s" : ""}
          </p>
        </div>
        {pendingPersonas.length > 0 && !isGenerating && (
          <button
            onClick={approveAll}
            disabled={approving === "all"}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {approving === "all" ? "Approving…" : "Approve All"}
          </button>
        )}
      </div>

      {/* Persona rows */}
      <div className="space-y-3">
        {campaign.campaign_personas.map((cp) => (
          <div key={cp.id} className="rounded-lg border border-slate-100 p-3 space-y-2">
            {/* Persona header row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: cp.persona.avatar_color }}
                >
                  {cp.persona.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs font-semibold text-slate-900">{cp.persona.name}</span>
              </div>

              {cp.approval_status === "pending" && !isGenerating && cp.variants.length > 0 && (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => rejectPersona(cp.persona.id)}
                    disabled={approving !== null}
                    className="inline-flex h-7 items-center rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-400 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => approvePersona(cp.persona.id)}
                    disabled={approving !== null}
                    className="inline-flex h-7 items-center rounded-lg bg-indigo-600 px-2.5 text-[11px] font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {approving === cp.persona.id ? "Approving…" : "Approve"}
                  </button>
                </div>
              )}

              {cp.approval_status === "approved" && (
                <span className="text-[11px] font-semibold text-emerald-600">✓ Approved</span>
              )}
              {cp.approval_status === "rejected" && (
                <span className="text-[11px] text-slate-400">Rejected</span>
              )}
            </div>

            {/* Generating state */}
            {isGenerating && cp.variants.length === 0 && (
              <TypingIndicator label="Generating…" />
            )}

            {/* Variant previews */}
            {cp.variants.map((variant) => (
              <div
                key={variant.id}
                className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
              >
                <span className="font-semibold capitalize text-slate-700">{variant.platform}</span>
                {" · "}
                {variant.body.slice(0, 120)}
                {variant.body.length > 120 ? "…" : ""}
              </div>
            ))}

            {cp.generation_error && (
              <p className="text-xs text-red-500">{cp.generation_error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
