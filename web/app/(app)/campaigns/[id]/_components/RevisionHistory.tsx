"use client";

import { Loader2, RotateCcw } from "lucide-react";

export interface Revision {
  revision_number: number;
  body: string;
  instruction: string | null;
  created_at: string;
}

type Props = {
  loading: boolean;
  revisions: Revision[];
  reverting: number | null;
  onRevert: (revNum: number) => void;
};

export function RevisionHistory({ loading, revisions, reverting, onRevert }: Props) {
  return (
    <div className="border-t border-border px-4 py-3">
      {loading ? (
        <p className="flex items-center gap-1.5 text-xs text-faint-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading history…
        </p>
      ) : revisions.length === 0 ? (
        <p className="text-xs text-faint-foreground">No revision history yet.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint-foreground">Revision history</p>
          <div className="max-h-52 overflow-y-auto space-y-2 pr-1">
            {revisions.map((rev) => (
              <div key={rev.revision_number} className="rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-semibold text-muted-foreground">
                    <span className="mono-num">v{rev.revision_number}</span>
                    {rev.instruction && <span className="ml-1.5 font-normal text-faint-foreground">— {rev.instruction}</span>}
                  </span>
                  <button
                    type="button"
                    disabled={reverting !== null}
                    onClick={() => onRevert(rev.revision_number)}
                    className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition hover:border-accent/40 hover:text-accent disabled:opacity-40"
                  >
                    {reverting === rev.revision_number ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                    Revert
                  </button>
                </div>
                <p className="line-clamp-2 leading-relaxed text-muted-foreground">{rev.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
