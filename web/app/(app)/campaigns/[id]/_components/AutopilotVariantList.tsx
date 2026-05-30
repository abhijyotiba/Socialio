"use client";

import { useState } from "react";
import { Check, X, Loader2 } from "lucide-react";

export interface AutopilotVariant {
  id: string;
  platform: string;
  body: string;
  status: string;
  format: string | null;
  angle: string | null;
}

const PLATFORM_LABEL: Record<string, string> = { linkedin: "LinkedIn", x: "X / Twitter" };

export function AutopilotVariantList({ initial }: { initial: AutopilotVariant[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pending = items.filter((v) => v.status === "pending_approval");

  async function review(id: string, action: "approve" | "reject") {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed");
      }
      setItems((prev) =>
        prev.map((v) =>
          v.id === id ? { ...v, status: action === "approve" ? "draft" : "cancelled" } : v
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function approveAll() {
    for (const v of pending) await review(v.id, "approve");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-faint-foreground">
          <span className="mono-num">{pending.length}</span> of <span className="mono-num">{items.length}</span> awaiting approval
        </p>
        {pending.length > 0 && (
          <button
            onClick={approveAll}
            disabled={busy !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-bold text-accent-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Approve all
          </button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {items.map((v) => (
        <div key={v.id} className="rounded-2xl panel p-5">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
              {PLATFORM_LABEL[v.platform] ?? v.platform}
            </span>
            {v.format && (
              <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {v.format.replace(/_/g, " ")}
              </span>
            )}
            {v.angle && (
              <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {v.angle}
              </span>
            )}
            <span className="ml-auto rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-faint-foreground">
              {v.status}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{v.body}</p>
          {v.status === "pending_approval" && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => review(v.id, "approve")}
                disabled={busy === v.id}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-success px-3 text-xs font-bold text-background transition hover:brightness-110 disabled:opacity-50"
              >
                {busy === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Approve
              </button>
              <button
                onClick={() => review(v.id, "reject")}
                disabled={busy === v.id}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-muted-foreground transition hover:border-red-400/50 hover:text-red-400 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" /> Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
