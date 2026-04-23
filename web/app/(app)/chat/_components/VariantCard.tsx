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
  | { kind: "loadingSlots" }
  | { kind: "pickingSlot"; nextSlots: string[] }
  | { kind: "pickingTime" }
  | { kind: "scheduling" }
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

  async function handleScheduleClick() {
    setState({ kind: "loadingSlots" });
    try {
      const res = await fetch(
        `/api/schedule-slots?platform=${variant.platform}`
      );
      if (!res.ok) throw new Error("Failed to load slots");
      const body = await res.json();
      const next: string[] = body.next ?? [];
      if (next.length > 0) {
        setState({ kind: "pickingSlot", nextSlots: next.slice(0, 3) });
      } else {
        setState({ kind: "pickingTime" });
      }
    } catch {
      // Fall back to custom picker if slots can't be fetched
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

  async function handleScheduleConfirm() {
    if (!scheduledAt) return;
    const utcDate = new Date(scheduledAt).toISOString();
    if (new Date(utcDate) <= new Date()) {
      setState({
        kind: "error",
        message: "Scheduled time must be in the future.",
      });
      return;
    }
    await scheduleAt(utcDate);
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
    state.kind === "loadingSlots" ||
    state.kind === "scheduling" ||
    state.kind === "cancelling";
  const showIdleActions =
    !isTerminal &&
    state.kind !== "pickingSlot" &&
    state.kind !== "pickingTime";

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
        {/* Terminal states */}
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

        {/* Slot picker — shows next configured slots as one-click buttons */}
        {state.kind === "pickingSlot" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Pick a slot:</p>
            <div className="flex flex-wrap gap-2">
              {state.nextSlots.map((slot) => (
                <button
                  key={slot}
                  onClick={() => scheduleAt(slot)}
                  className="px-3 py-1.5 rounded-md border text-xs hover:bg-accent transition-colors"
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
            <button
              onClick={() => setState({ kind: "pickingTime" })}
              className="text-xs text-primary underline"
            >
              Pick custom time →
            </button>
            <button
              onClick={() => setState({ kind: "idle" })}
              className="text-xs text-muted-foreground underline ml-3"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Custom datetime picker */}
        {state.kind === "pickingTime" && (
          <div className="space-y-2">
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
            <p className="text-xs text-muted-foreground">
              Configure posting schedule in{" "}
              <a href="/settings/schedule" className="underline text-primary">
                Settings
              </a>{" "}
              for quick slots.
            </p>
          </div>
        )}

        {/* Idle / busy action buttons */}
        {showIdleActions && (
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
              onClick={handleScheduleClick}
              disabled={isBusy}
              className="px-3 py-1 rounded-md border text-xs disabled:opacity-50 flex items-center gap-1"
            >
              {state.kind === "loadingSlots" ? (
                <>
                  <span className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
                  Loading…
                </>
              ) : (
                "Schedule"
              )}
            </button>
          </div>
        )}

        {state.kind === "cancelling" && (
          <p className="text-xs text-muted-foreground">Cancelling…</p>
        )}
      </div>
    </div>
  );
}
