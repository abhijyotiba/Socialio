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
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 shadow-sm shadow-indigo-500/30">
        <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <div
        className={`flex-1 overflow-hidden rounded-2xl rounded-tl-sm border border-slate-200/70 bg-white shadow-sm ${
          noPadding ? "" : "px-4 py-3"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
