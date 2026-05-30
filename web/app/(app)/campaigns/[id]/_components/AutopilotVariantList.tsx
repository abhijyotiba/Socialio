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
        <p className="text-xs text-slate-400">
          {pending.length} of {items.length} awaiting approval
        </p>
        {pending.length > 0 && (
          <button
            onClick={approveAll}
            disabled={busy !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> Approve all
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {items.map((v) => (
        <div key={v.id} className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
              {PLATFORM_LABEL[v.platform] ?? v.platform}
            </span>
            {v.format && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {v.format.replace(/_/g, " ")}
              </span>
            )}
            {v.angle && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {v.angle}
              </span>
            )}
            <span className="ml-auto rounded-md bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
              {v.status}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{v.body}</p>
          {v.status === "pending_approval" && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => review(v.id, "approve")}
                disabled={busy === v.id}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy === v.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Approve
              </button>
              <button
                onClick={() => review(v.id, "reject")}
                disabled={busy === v.id}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-600 disabled:opacity-50"
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
