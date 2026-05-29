"use client";

import { useState } from "react";
import { Check, X, Loader2, Sparkles } from "lucide-react";

interface ReviewVariant {
  id: string;
  platform: string;
  body: string;
  format: string | null;
  angle: string | null;
}

const PLATFORM_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X / Twitter",
};

export function ReviewList({ initial }: { initial: ReviewVariant[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setItems((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function approveAll() {
    setBulkBusy(true);
    setError(null);
    // Sequential to keep it simple and avoid hammering the worker; the queue is
    // small (a batch, not thousands).
    for (const v of [...items]) {
      try {
        const res = await fetch(`/api/posts/${v.id}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve" }),
        });
        if (res.ok) setItems((prev) => prev.filter((x) => x.id !== v.id));
      } catch {
        // leave it in the list; the user can retry
      }
    }
    setBulkBusy(false);
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200/60 bg-gradient-to-b from-white to-indigo-50/20 py-16 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-400/30">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <p className="text-sm font-semibold text-slate-700">Nothing to review</p>
        <p className="mt-1 text-[11px] text-slate-400">
          New posts appear here when the engine refills your queue.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {items.length} post{items.length === 1 ? "" : "s"} awaiting approval
        </p>
        <button
          onClick={approveAll}
          disabled={bulkBusy}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Approve all
        </button>
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {items.map((v) => (
        <div
          key={v.id}
          className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm"
        >
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
          </div>

          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{v.body}</p>

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
              <X className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
