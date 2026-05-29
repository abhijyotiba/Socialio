import type { CampaignWithPersonas } from "@/lib/db/campaigns";
import { VariantCard } from "./VariantCard";

type CampaignPersona = CampaignWithPersonas["campaign_personas"][number];

type Props = {
  cp: CampaignPersona;
  jobId?: string;
  isGenerating: boolean;
  pendingAction: string | null;
  voiceChanged: boolean;
  onApprove: (personaId: string) => void;
  onReject: (personaId: string) => void;
};

export function PersonaGroup({ cp, jobId, isGenerating, pendingAction, voiceChanged, onApprove, onReject }: Props) {
  const approveBusy = pendingAction === `approve-${cp.persona.id}`;
  const rejectBusy = pendingAction === `reject-${cp.persona.id}`;
  const lockedOut = pendingAction !== null;

  return (
    <li className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ backgroundColor: cp.persona.avatar_color }}
          >
            {cp.persona.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{cp.persona.name}</p>
            <p className="text-[10px] text-slate-400">
              {cp.variants.length} variant{cp.variants.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {cp.approval_status === "pending" && !isGenerating && cp.variants.length > 0 && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onReject(cp.persona.id)}
              disabled={lockedOut}
              className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-400 disabled:opacity-50"
            >
              {rejectBusy ? "Rejecting…" : "Reject"}
            </button>
            <button
              type="button"
              onClick={() => onApprove(cp.persona.id)}
              disabled={lockedOut}
              className="inline-flex h-8 items-center rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {approveBusy ? "Approving…" : "Approve"}
            </button>
          </div>
        )}
        {cp.approval_status === "approved" && (
          <span className="text-xs font-semibold text-emerald-600">✓ Approved</span>
        )}
        {cp.approval_status === "rejected" && (
          <span className="text-xs text-slate-400">Rejected</span>
        )}
      </div>

      {voiceChanged && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
          This persona&apos;s voice profile has been updated since these variants were generated. Regenerate if you want the latest voice.
        </div>
      )}

      {isGenerating && cp.variants.length === 0 && (
        <p className="text-xs text-slate-400">Generating…</p>
      )}

      {cp.generation_error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{cp.generation_error}</p>
      )}

      <div className="space-y-3">
        {cp.variants.map((v) => (
          <VariantCard
            key={v.id}
            variant={{ id: v.post_variant_id, platform: v.platform, body: v.body }}
            jobId={jobId}
          />
        ))}
      </div>
    </li>
  );
}
