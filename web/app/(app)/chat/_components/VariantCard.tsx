"use client";

import { useState } from "react";
import { Copy, CheckCheck, ExternalLink, Loader2 } from "lucide-react";

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

const platformConfig: Record<string, { label: string; bg: string; text: string }> = {
  linkedin: { label: "LinkedIn", bg: "bg-[#e8f4fb]", text: "text-[#0077b5]" },
  x: { label: "X / Twitter", bg: "bg-slate-100", text: "text-slate-800" },
};

export function VariantCard({ variant }: { variant: Variant }) {
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [scheduledAt, setScheduledAt] = useState("");
  const [copied, setCopied] = useState(false);

  const plt = platformConfig[variant.platform] ?? {
    label: variant.platform,
    bg: "bg-gray-100",
    text: "text-gray-700",
  };

  async function handleCopy() {
    await navigator.clipboard.writeText(variant.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handlePublishNow() {
    setState({ kind: "publishing" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/publish`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: data.error ?? "Publish failed." });
        return;
      }
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
      if (next.length > 0) {
        setState({ kind: "pickingSlot", nextSlots: next.slice(0, 3) });
      } else {
        setState({ kind: "pickingTime" });
      }
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
        setState({
          kind: "error",
          message:
            data.error?.formErrors?.[0] ?? data.error ?? "Schedule failed.",
        });
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

  const isBusy =
    state.kind === "publishing" ||
    state.kind === "loadingSlots" ||
    state.kind === "scheduling" ||
    state.kind === "cancelling";
  const isTerminal =
    state.kind === "published" ||
    state.kind === "scheduled" ||
    state.kind === "cancelled";
  const showIdleActions =
    !isTerminal &&
    state.kind !== "pickingSlot" &&
    state.kind !== "pickingTime";

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${plt.bg} ${plt.text}`}>
          {plt.label}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-700"
        >
          {copied ? (
            <>
              <CheckCheck className="h-3.5 w-3.5 text-green-500" />
              <span className="text-green-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>

      <div className="px-5 py-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {variant.body}
        </p>
      </div>

      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3">
        {state.kind === "published" && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-green-600">
              <CheckCheck className="h-4 w-4" />
              Published
            </span>
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
            >
              View post
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {state.kind === "scheduled" && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-indigo-600">
              Scheduled for{" "}
              {new Date(state.scheduledAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <button
              onClick={handleCancel}
              disabled={isBusy}
              className="text-xs font-medium text-red-500 transition-colors hover:text-red-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}

        {state.kind === "cancelled" && (
          <p className="text-sm text-slate-500">Cancelled.</p>
        )}

        {state.kind === "error" && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-red-500">{state.message}</p>
            <button
              onClick={() => setState({ kind: "idle" })}
              className="ml-2 shrink-0 text-xs font-medium text-slate-400 hover:text-slate-600"
            >
              Dismiss
            </button>
          </div>
        )}

        {state.kind === "pickingSlot" && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Pick a slot
            </p>
            <div className="flex flex-wrap gap-2">
              {state.nextSlots.map((slot) => (
                <button
                  key={slot}
                  onClick={() => scheduleAt(slot)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-indigo-400 hover:text-indigo-600"
                >
                  {new Date(slot).toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => setState({ kind: "pickingTime" })}
                className="text-xs font-medium text-indigo-600 hover:underline"
              >
                Custom time →
              </button>
              <button
                onClick={() => setState({ kind: "idle" })}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {state.kind === "pickingTime" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm transition-colors focus:border-indigo-500 focus:outline-none"
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              />
              <button
                onClick={handleScheduleConfirm}
                disabled={!scheduledAt}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-95 disabled:opacity-40"
              >
                Confirm
              </button>
              <button
                onClick={() => setState({ kind: "idle" })}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Configure slots in{" "}
              <a
                href="/settings/schedule"
                className="text-indigo-600 hover:underline"
              >
                Settings
              </a>
              {" "}for one-click scheduling.
            </p>
          </div>
        )}

        {showIdleActions && (
          <div className="flex gap-2">
            <button
              onClick={handlePublishNow}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
            >
              {state.kind === "publishing" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Publishing…
                </>
              ) : (
                "Publish now"
              )}
            </button>
            <button
              onClick={handleScheduleClick}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40"
            >
              {state.kind === "loadingSlots" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading…
                </>
              ) : (
                "Schedule"
              )}
            </button>
          </div>
        )}

        {state.kind === "cancelling" && (
          <p className="text-xs text-slate-500">Cancelling…</p>
        )}
      </div>
    </div>
  );
}
