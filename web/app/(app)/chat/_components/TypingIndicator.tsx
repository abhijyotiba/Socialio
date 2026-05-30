export function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-2.5 animate-message-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent ring-1 ring-border">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <div className="flex items-center gap-3 rounded-2xl rounded-tl-sm border border-border bg-surface px-4 py-2.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="typing-dot block h-1.5 w-1.5 rounded-full bg-accent"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
