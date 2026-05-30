import { Link2, Type } from "lucide-react";

export function UserBubble({ text, isUrl }: { text: string; isUrl: boolean }) {
  return (
    <div className="flex justify-end animate-message-in">
      <div className="max-w-[76%]">
        <div className="mb-1 flex items-center justify-end gap-1">
          {isUrl ? (
            <Link2 className="h-3 w-3 text-accent" />
          ) : (
            <Type className="h-3 w-3 text-accent" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
            {isUrl ? "URL" : "Idea"}
          </span>
        </div>
        <div className="rounded-2xl rounded-tr-sm bg-accent px-4 py-2.5 shadow-sm">
          <p className="break-all text-sm leading-relaxed text-accent-foreground font-medium">{text}</p>
        </div>
      </div>
    </div>
  );
}
