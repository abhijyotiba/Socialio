import { Link2, Type } from "lucide-react";

export function UserBubble({ text, isUrl }: { text: string; isUrl: boolean }) {
  return (
    <div className="flex justify-end animate-message-in">
      <div className="max-w-[76%]">
        <div className="mb-1 flex items-center justify-end gap-1">
          {isUrl ? (
            <Link2 className="h-3 w-3 text-indigo-300" />
          ) : (
            <Type className="h-3 w-3 text-indigo-300" />
          )}
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-indigo-300">
            {isUrl ? "URL" : "Idea"}
          </span>
        </div>
        <div className="rounded-2xl rounded-tr-sm bg-gradient-to-br from-indigo-600 to-violet-600 px-4 py-2.5 shadow-sm shadow-indigo-500/20">
          <p className="break-all text-sm leading-relaxed text-white">{text}</p>
        </div>
      </div>
    </div>
  );
}
