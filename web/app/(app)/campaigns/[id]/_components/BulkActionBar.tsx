"use client";

import { Loader2, CheckCheck, Sparkles, CalendarClock, X } from "lucide-react";

type Props = {
  selectedCount: number;
  inFlight: boolean;
  onApprove: () => void;
  onRegenerate: () => void;
  onSchedule: () => void;
  onClear: () => void;
};

// Sticky action bar for the review grid. Shows the selected count and the three
// bulk actions. All buttons disable while a request is in flight.
export function BulkActionBar({
  selectedCount,
  inFlight,
  onApprove,
  onRegenerate,
  onSchedule,
  onClear,
}: Props) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-4 z-30 mx-auto flex w-fit items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur">
      <span className="text-xs font-semibold text-slate-700">
        {selectedCount} selected
      </span>
      <div className="h-4 w-px bg-slate-200" />
      <button
        type="button"
        onClick={onApprove}
        disabled={inFlight}
        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        {inFlight ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCheck className="h-3.5 w-3.5" />
        )}
        Approve
      </button>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={inFlight}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Regenerate
      </button>
      <button
        type="button"
        onClick={onSchedule}
        disabled={inFlight}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
      >
        <CalendarClock className="h-3.5 w-3.5" />
        Schedule
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={inFlight}
        className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
        aria-label="Clear selection"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
