"use client";

import { useState } from "react";

type Variant = {
  id: string;
  platform: string;
  body: string;
};

type ActionState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "published"; url: string }
  | { kind: "scheduling" }
  | { kind: "pickingTime" }
  | { kind: "scheduled"; scheduledAt: string }
  | { kind: "cancelling" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

export function VariantCard({ variant }: { variant: Variant }) {
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [scheduledAt, setScheduledAt] = useState("");

  async function handlePublishNow() {
    setState({ kind: "publishing" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/publish`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setState({
          kind: "error",
          message: data.error ?? "Publish failed. Please try again.",
        });
        return;
      }
      setState({ kind: "published", url: data.platform_post_url });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleScheduleConfirm() {
    if (!scheduledAt) return;
    // Convert local datetime-local value to UTC ISO string
    const utcDate = new Date(scheduledAt).toISOString();
    if (new Date(utcDate) <= new Date()) {
      setState({ kind: "error", message: "Scheduled time must be in the future." });
      return;
    }
    setState({ kind: "scheduling" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: utcDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({
          kind: "error",
          message:
            data.error?.formErrors?.[0] ??
            data.error ??
            "Schedule failed. Please try again.",
        });
        return;
      }
      setState({ kind: "scheduled", scheduledAt: data.scheduled_at });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleCancel() {
    setState({ kind: "cancelling" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/cancel`, {
        method: "POST",
      });
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

  const platformLabel =
    variant.platform === "linkedin" ? "LinkedIn" : "X / Twitter";

  const isTerminal =
    state.kind === "published" ||
    state.kind === "scheduled" ||
    state.kind === "cancelled";
  const isBusy =
    state.kind === "publishing" ||
    state.kind === "scheduling" ||
    state.kind === "cancelling";

  return (
    <div className="border rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {platformLabel}
        </span>
        <button
          onClick={() => navigator.clipboard.writeText(variant.body)}
          className="text-xs text-primary underline"
        >
          Copy
        </button>
      </div>

      {/* Body */}
      <p className="text-sm whitespace-pre-wrap">{variant.body}</p>

      {/* Actions */}
      <div className="pt-1 border-t space-y-2">
        {/* Success states */}
        {state.kind === "published" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <span>Published ✓</span>
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-primary text-xs"
            >
              View post →
            </a>
          </div>
        )}

        {state.kind === "scheduled" && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-blue-600">
              Scheduled for{" "}
              {new Date(state.scheduledAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <button
              onClick={handleCancel}
              disabled={isBusy}
              className="text-xs text-destructive underline disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}

        {state.kind === "cancelled" && (
          <p className="text-sm text-muted-foreground">Cancelled.</p>
        )}

        {/* Error */}
        {state.kind === "error" && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-destructive">{state.message}</p>
            <button
              onClick={() => setState({ kind: "idle" })}
              className="text-xs text-muted-foreground underline ml-2 shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Datetime picker for scheduling */}
        {state.kind === "pickingTime" && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="text-sm border rounded px-2 py-1 bg-background"
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
            />
            <button
              onClick={handleScheduleConfirm}
              disabled={!scheduledAt}
              className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              onClick={() => setState({ kind: "idle" })}
              className="text-xs text-muted-foreground underline"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Idle / busy action buttons */}
        {!isTerminal && state.kind !== "pickingTime" && (
          <div className="flex gap-2">
            <button
              onClick={handlePublishNow}
              disabled={isBusy}
              className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 flex items-center gap-1"
            >
              {state.kind === "publishing" ? (
                <>
                  <span className="h-3 w-3 rounded-full border-2 border-primary-foreground border-t-transparent animate-spin" />
                  Publishing…
                </>
              ) : (
                "Publish now"
              )}
            </button>
            <button
              onClick={() => setState({ kind: "pickingTime" })}
              disabled={isBusy}
              className="px-3 py-1 rounded-md border text-xs disabled:opacity-50"
            >
              Schedule
            </button>
          </div>
        )}

        {/* Cancelling spinner */}
        {state.kind === "cancelling" && (
          <p className="text-xs text-muted-foreground">Cancelling…</p>
        )}
      </div>
    </div>
  );
}
