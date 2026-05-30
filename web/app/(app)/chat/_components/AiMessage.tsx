import { ReactNode } from "react";

export function AiMessage({
  children,
  noPadding = false,
}: {
  children: ReactNode;
  noPadding?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 animate-message-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent ring-1 ring-border">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <div
        className={`flex-1 overflow-hidden rounded-2xl rounded-tl-sm border border-border bg-surface ${
          noPadding ? "" : "px-4 py-3"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
