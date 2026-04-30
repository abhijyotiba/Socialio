"use client";

import { useState } from "react";
import { Copy, CheckCheck, ExternalLink, Loader2, Zap, CalendarClock, X, Sparkles, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { MediaPicker } from "./MediaPicker";

type Variant = {
  id: string;
  platform: string;
  body: string;
};

type ActionState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "published"; url: string }
  | { kind: "loadingSlots" }
  | { kind: "pickingSlot"; nextSlots: string[] }
  | { kind: "pickingTime" }
  | { kind: "scheduling" }
  | { kind: "scheduled"; scheduledAt: string }
  | { kind: "cancelling" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

const PLATFORM_CONFIG: Record<string, {
  label: string;
  iconBg: string;
  badgeBg: string;
  badgeText: string;
  icon: React.ReactNode;
}> = {
  linkedin: {
    label: "LinkedIn",
    iconBg: "bg-[#0077b5]",
    badgeBg: "bg-[#0077b5]/10",
    badgeText: "text-[#0077b5]",
    icon: (
      <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  x: {
    label: "X / Twitter",
    iconBg: "bg-slate-900",
    badgeBg: "bg-slate-100",
    badgeText: "text-slate-700",
    icon: (
      <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    ),
  },
};

const QUICK_ACTIONS = [
  "Shorter",
  "Longer",
  "More personal",
  "Less corporate",
  "Change hook",
  "Add CTA",
  "Add question",
];

interface Revision {
  revision_number: number;
  body: string;
  instruction: string | null;
  created_at: string;
}

export function VariantCard({ variant, jobId }: { variant: Variant; jobId?: string }) {
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [scheduledAt, setScheduledAt] = useState("");
  const [copied, setCopied] = useState(false);

  // Inline regeneration state
  const [currentBody, setCurrentBody] = useState(variant.body);
  const [showRefine, setShowRefine] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [revisionNumber, setRevisionNumber] = useState<number | null>(null);

  // Revision history state
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [reverting, setReverting] = useState<number | null>(null);

  const plt = PLATFORM_CONFIG[variant.platform] ?? {
    label: variant.platform,
    iconBg: "bg-slate-400",
    badgeBg: "bg-slate-100",
    badgeText: "text-slate-700",
    icon: null,
  };

  async function handleCopy() {
    await navigator.clipboard.writeText(currentBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

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
        setState({ kind: "error", message: data.error?.formErrors?.[0] ?? data.error ?? "Schedule failed." });
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
      // Invalidate cached revisions so history reloads fresh
      setRevisions([]);
      setShowHistory(false);
    } catch {
      setRegenError("Network error. Please try again.");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleQuickAction(action: string) {
    await handleRegenerate(action);
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

  const isBusy = ["publishing", "loadingSlots", "scheduling", "cancelling"].includes(state.kind);
  const isTerminal = ["published", "scheduled", "cancelled"].includes(state.kind);
  const showIdleActions = !isTerminal && state.kind !== "pickingSlot" && state.kind !== "pickingTime";

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md hover:border-indigo-200/60">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-md ${plt.iconBg}`}>
            {plt.icon}
          </div>
          <span className={`text-[11px] font-bold uppercase tracking-[0.12em] ${plt.badgeText}`}>
            {plt.label}
          </span>
          {revisionNumber !== null && (
            <span className="rounded-full bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-500 ring-1 ring-inset ring-indigo-200">
              v{revisionNumber}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] font-medium text-slate-400 transition hover:text-slate-700"
        >
          {copied ? (
            <><CheckCheck className="h-3.5 w-3.5 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
          ) : (
            <><Copy className="h-3.5 w-3.5" />Copy</>
          )}
        </button>
      </div>

      {/* Body */}
      <div className="px-4 py-3.5">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {currentBody}
        </p>
      </div>

      {/* Inline refine panel — quick chips + free-text input */}
      {showIdleActions && showRefine && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                disabled={regenerating}
                onClick={() => handleQuickAction(action)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40"
              >
                {action}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleRegenerate(instruction);
                }
              }}
              placeholder="Describe what to change…"
              disabled={regenerating}
              className="h-9 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => handleRegenerate(instruction)}
              disabled={!instruction.trim() || regenerating}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40"
            >
              {regenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {regenerating ? "Rewriting…" : "Rewrite"}
            </button>
          </div>
          {regenError && (
            <p className="text-xs text-red-500">{regenError}</p>
          )}
        </div>
      )}

      {/* Revision history panel */}
      {revisionNumber !== null && showHistory && (
        <div className="border-t border-slate-100 px-4 py-3">
          {loadingRevisions ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading history…
            </p>
          ) : revisions.length === 0 ? (
            <p className="text-xs text-slate-400">No revision history yet.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Revision history</p>
              <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
                {revisions.map((rev) => (
                  <div
                    key={rev.revision_number}
                    className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-600">
                        v{rev.revision_number}
                        {rev.instruction && (
                          <span className="ml-1.5 font-normal text-slate-400">— {rev.instruction}</span>
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={reverting !== null}
                        onClick={() => handleRevert(rev.revision_number)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
                      >
                        {reverting === rev.revision_number ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        Revert
                      </button>
                    </div>
                    <p className="line-clamp-2 leading-relaxed text-slate-500">{rev.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Media picker */}
      {showIdleActions && (
        <MediaPicker variantId={variant.id} jobId={jobId} />
      )}

      {/* Footer actions */}
      <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">

        {/* Terminal states */}
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
              Scheduled for{" "}
              {new Date(state.scheduledAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </span>
            <button onClick={handleCancel} disabled={isBusy}
              className="text-[11px] font-medium text-red-400 transition hover:text-red-600 disabled:opacity-50">
              Cancel
            </button>
          </div>
        )}

        {state.kind === "cancelled" && (
          <p className="text-xs text-slate-400">Post cancelled and moved to drafts.</p>
        )}

        {state.kind === "cancelling" && (
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 className="h-3 w-3 animate-spin" /> Cancelling…
          </p>
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

        {/* Slot picker */}
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
              <button onClick={() => setState({ kind: "pickingTime" })}
                className="text-[11px] font-semibold text-indigo-600 hover:underline">
                Custom time →
              </button>
              <button onClick={() => setState({ kind: "idle" })}
                className="text-[11px] font-medium text-slate-400 hover:text-slate-600">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Custom time picker */}
        {state.kind === "pickingTime" && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <button onClick={handleScheduleConfirm} disabled={!scheduledAt}
                className="h-9 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40">
                Confirm
              </button>
              <button onClick={() => setState({ kind: "idle" })}
                className="text-[11px] font-medium text-slate-400 hover:text-slate-600">
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Configure slots in{" "}
              <a href="/settings/schedule" className="font-medium text-indigo-600 hover:underline">Settings</a>
              {" "}for one-click scheduling.
            </p>
          </div>
        )}

        {/* Idle actions */}
        {showIdleActions && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-2">
              <button onClick={handlePublishNow} disabled={isBusy || regenerating}
                className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-700 disabled:opacity-40">
                {state.kind === "publishing"
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Publishing…</>
                  : <><Zap className="h-3 w-3" /> Publish now</>}
              </button>
              <button onClick={handleScheduleClick} disabled={isBusy || regenerating}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40">
                {state.kind === "loadingSlots"
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Loading…</>
                  : <><CalendarClock className="h-3 w-3" /> Schedule</>}
              </button>
            </div>

            {/* Refine + history controls */}
            <div className="flex items-center gap-1.5">
              {revisionNumber !== null && (
                <button
                  type="button"
                  onClick={toggleHistory}
                  disabled={regenerating}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
                  title="Revision history"
                >
                  <RotateCcw className="h-3 w-3" />
                  {showHistory ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              )}
              <button
                type="button"
                onClick={() => { setShowRefine((v) => !v); setRegenError(null); }}
                disabled={regenerating}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-bold transition disabled:opacity-40 ${
                  showRefine
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
                }`}
              >
                <Sparkles className="h-3 w-3" />
                Refine
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
