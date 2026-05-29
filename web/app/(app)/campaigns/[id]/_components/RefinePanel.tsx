"use client";

import { Loader2, Sparkles } from "lucide-react";

const QUICK_ACTIONS = ["Shorter", "Longer", "More personal", "Less corporate", "Change hook", "Add CTA", "Add question"];

type Props = {
  instruction: string;
  onInstructionChange: (v: string) => void;
  onRegenerate: (instruction: string) => void;
  regenerating: boolean;
  regenError: string | null;
};

export function RefinePanel({ instruction, onInstructionChange, onRegenerate, regenerating, regenError }: Props) {
  return (
    <div className="border-t border-slate-100 px-4 py-3 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            disabled={regenerating}
            onClick={() => onRegenerate(action)}
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
          onChange={(e) => onInstructionChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onRegenerate(instruction);
            }
          }}
          placeholder="Describe what to change…"
          disabled={regenerating}
          className="h-9 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => onRegenerate(instruction)}
          disabled={!instruction.trim() || regenerating}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-40"
        >
          {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {regenerating ? "Rewriting…" : "Rewrite"}
        </button>
      </div>
      {regenError && <p className="text-xs text-red-500">{regenError}</p>}
    </div>
  );
}
