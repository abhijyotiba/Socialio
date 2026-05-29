"use client";

import { useState, memo } from "react";
import { Loader2, Zap, CalendarClock, X, Sparkles, RotateCcw, ChevronDown, ChevronUp, CheckCheck, ExternalLink } from "lucide-react";
import { MediaPicker } from "./MediaPicker";
import { VariantBody } from "./VariantBody";
import { RefinePanel } from "./RefinePanel";
import { RevisionHistory, type Revision } from "./RevisionHistory";
import { useNowPlusMinutes } from "@/lib/hooks/useNowPlusMinutes";
import { isBusy, showIdleActions, type ActionState } from "@/lib/posts/variant-actions";

type Variant = { id: string; platform: string; body: string };

export const VariantCard = memo(function VariantCard({ variant, jobId }: { variant: Variant; jobId?: string }) {
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [scheduledAt, setScheduledAt] = useState("");
  const [currentBody, setCurrentBody] = useState(variant.body);
  const [showRefine, setShowRefine] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [revisionNumber, setRevisionNumber] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [reverting, setReverting] = useState<number | null>(null);

  const minScheduleTime = useNowPlusMinutes(1);
  const busy = isBusy(state);
  const idleActions = showIdleActions(state);

  async function handlePublishNow() {
    setState({ kind: "publishing" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setState({ kind: "error", message: data.error ?? "Publish failed." }); return; }
      setState({ kind: "published", url: data.platform_post_url });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleScheduleClick() {
    setState({ kind: "loadingSlots" });
    try {
      const res = await fetch(`/api/schedule-slots?platform=${variant.platform}`);
      if (!res.ok) throw new Error();
      const body = await res.json();
      const next: string[] = body.next ?? [];
      setState(next.length > 0 ? { kind: "pickingSlot", nextSlots: next.slice(0, 3) } : { kind: "pickingTime" });
    } catch {
      setState({ kind: "pickingTime" });
    }
  }

  async function scheduleAt(utcIso: string) {
    setState({ kind: "scheduling" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: utcIso }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMessage =
          data.error?.formErrors?.[0] ??
          (typeof data.error === "string" ? data.error : null) ??
          "Schedule failed.";
        setState({ kind: "error", message: errorMessage });
        return;
      }
      setState({ kind: "scheduled", scheduledAt: data.scheduled_at });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleScheduleConfirm() {
    if (!scheduledAt) return;
    const utcDate = new Date(scheduledAt).toISOString();
    if (new Date(utcDate) <= new Date()) {
      setState({ kind: "error", message: "Scheduled time must be in the future." });
      return;
    }
    await scheduleAt(utcDate);
  }

  async function handleCancel() {
    setState({ kind: "cancelling" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setState({ kind: "error", message: data.error ?? "Cancel failed." });
        return;
      }
      setState({ kind: "cancelled" });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleRegenerate(instr: string) {
    if (!instr.trim()) return;
    setRegenError(null);
    setRegenerating(true);
    try {
      const res = await fetch(`/api/posts/${variant.id}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instr.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegenError(data.error ?? "Regeneration failed. Please try again.");
        return;
      }
      setCurrentBody(data.body);
      setRevisionNumber(data.revision_number);
      setInstruction("");
      setShowRefine(false);
      setRevisions([]);
      setShowHistory(false);
    } catch {
      setRegenError("Network error. Please try again.");
    } finally {
      setRegenerating(false);
    }
  }

  async function loadRevisions() {
    if (loadingRevisions) return;
    setLoadingRevisions(true);
    try {
      const res = await fetch(`/api/posts/${variant.id}/revisions`);
      const data = await res.json();
      if (res.ok) setRevisions(data.revisions ?? []);
    } finally {
      setLoadingRevisions(false);
    }
  }

  async function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next && revisions.length === 0) await loadRevisions();
  }

  async function handleRevert(revNum: number) {
    setReverting(revNum);
    try {
      const res = await fetch(`/api/posts/${variant.id}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision_number: revNum }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegenError(data.error ?? "Revert failed.");
        return;
      }
      setCurrentBody(data.body);
      setRevisionNumber(data.revision_number);
      setRevisions([]);
      setShowHistory(false);
    } finally {
      setReverting(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md hover:border-indigo-200/60">
      <VariantBody platform={variant.platform} body={currentBody} revisionNumber={revisionNumber} />

      {idleActions && showRefine && (
        <RefinePanel
          instruction={instruction}
          onInstructionChange={setInstruction}
          onRegenerate={handleRegenerate}
          regenerating={regenerating}
          regenError={regenError}
        />
      )}

      {revisionNumber !== null && showHistory && (
        <RevisionHistory
          loading={loadingRevisions}
          revisions={revisions}
          reverting={reverting}
          onRevert={handleRevert}
        />
      )}

      {idleActions && <MediaPicker variantId={variant.id} jobId={jobId} />}

      {/* Footer actions */}
      <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
        {state.kind === "published" && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600">
              <CheckCheck className="h-4 w-4" /> Published
            </span>
            <a href={state.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline">
              View post <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {state.kind === "scheduled" && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600">
              <CalendarClock className="h-3.5 w-3.5" />
              Scheduled for {new Date(state.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </span>
            <button onClick={handleCancel} disabled={busy}
              className="text-[11px] font-medium text-red-400 transition hover:text-red-600 disabled:opacity-50">
              Cancel
            </button>
          </div>
        )}

        {state.kind === "cancelled" && <p className="text-xs text-slate-400">Post cancelled and moved to drafts.</p>}

        {state.kind === "cancelling" && (
          <p className="flex items-center gap-1.5 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Cancelling…</p>
        )}

        {state.kind === "error" && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-red-500">{state.message}</p>
            <button onClick={() => setState({ kind: "idle" })}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {state.kind === "pickingSlot" && (
          <div className="space-y-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Pick a time slot</p>
            <div className="flex flex-wrap gap-1.5">
              {state.nextSlots.map((slot) => (
                <button key={slot} onClick={() => scheduleAt(slot)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-600">
                  {new Date(slot).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setState({ kind: "pickingTime" })} className="text-[11px] font-semibold text-indigo-600 hover:underline">Custom time →</button>
              <button onClick={() => setState({ kind: "idle" })} className="text-[11px] font-medium text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          </div>
        )}

        {state.kind === "pickingTime" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} min={minScheduleTime}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              <button onClick={handleScheduleConfirm} disabled={!scheduledAt}
                className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40">Confirm</button>
              <button onClick={() => setState({ kind: "idle" })} className="text-[11px] font-medium text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
            <p className="text-[11px] text-slate-400">
              Configure slots in <a href="/settings/schedule" className="font-medium text-indigo-600 hover:underline">Settings</a> for one-click scheduling.
            </p>
          </div>
        )}

        {idleActions && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              <button onClick={handlePublishNow} disabled={busy || regenerating}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-700 disabled:opacity-40">
                {state.kind === "publishing" ? <><Loader2 className="h-3 w-3 animate-spin" /> Publishing…</> : <><Zap className="h-3 w-3" /> Publish now</>}
              </button>
              <button onClick={handleScheduleClick} disabled={busy || regenerating}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40">
                {state.kind === "loadingSlots" ? <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</> : <><CalendarClock className="h-3 w-3" /> Schedule</>}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              {revisionNumber !== null && (
                <button type="button" onClick={toggleHistory} disabled={regenerating} title="Revision history"
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40">
                  <RotateCcw className="h-3 w-3" />
                  {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}
              <button type="button"
                onClick={() => { setShowRefine((v) => !v); setRegenError(null); }}
                disabled={regenerating}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-bold transition disabled:opacity-40 ${showRefine ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600"}`}>
                <Sparkles className="h-3 w-3" /> Refine
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
