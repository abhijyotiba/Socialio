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
    <div className="border-t border-border px-4 py-3 space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            disabled={regenerating}
            onClick={() => onRegenerate(action)}
            className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-semibold text-muted-foreground transition hover:border-accent/40 hover:bg-accent/10 hover:text-accent disabled:opacity-40"
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
          className="h-9 flex-1 rounded-xl border border-input bg-surface px-3 text-sm text-foreground placeholder:text-faint-foreground transition focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => onRegenerate(instruction)}
          disabled={!instruction.trim() || regenerating}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-bold text-accent-foreground transition hover:brightness-110 disabled:opacity-40"
        >
          {regenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {regenerating ? "Rewriting…" : "Rewrite"}
        </button>
      </div>
      {regenError && <p className="text-xs text-destructive">{regenError}</p>}
    </div>
  );
}
