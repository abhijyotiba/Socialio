export function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-2.5 animate-message-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 shadow-sm shadow-indigo-500/30">
        <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <div className="flex items-center gap-3 rounded-2xl rounded-tl-sm border border-slate-200/70 bg-white px-4 py-2.5 shadow-sm">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="typing-dot block h-1.5 w-1.5 rounded-full bg-indigo-400"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
