"use client";

import { useRef, useEffect } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  isLoading: boolean;
};

export function ChatInput({ value, onChange, onSubmit, disabled, isLoading }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [value]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="shrink-0 px-2 pb-3 pt-2">
      <div className="flex items-end gap-2.5 rounded-2xl border border-border bg-surface px-4 py-3 transition-all focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-ring/30">
        <textarea
          ref={textareaRef}
          rows={1}
          className="max-h-[160px] min-h-[22px] flex-1 resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-faint-foreground focus:outline-none"
          placeholder="Paste a URL, add your angle, or just describe a topic…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground transition hover:brightness-110 disabled:opacity-40"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-faint-foreground">
        Enter to send • Shift + Enter for new line
      </p>
    </div>
  );
}
