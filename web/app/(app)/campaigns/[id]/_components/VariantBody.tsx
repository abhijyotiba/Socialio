"use client";

import { useState } from "react";
import { Copy, CheckCheck } from "lucide-react";
import { PlatformChip } from "@/components/spine/PlatformChip";

type Props = { platform: string; body: string; revisionNumber: number | null };

export function VariantBody({ platform, body, revisionNumber }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <PlatformChip platform={platform} />
          {revisionNumber !== null && (
            <span className="mono-num rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent ring-1 ring-inset ring-accent/30">
              v{revisionNumber}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] font-medium text-faint-foreground transition hover:text-foreground"
        >
          {copied ? (
            <><CheckCheck className="h-3.5 w-3.5 text-success" /><span className="text-success">Copied</span></>
          ) : (
            <><Copy className="h-3.5 w-3.5" />Copy</>
          )}
        </button>
      </div>
      <div className="px-4 py-3.5">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{body}</p>
      </div>
    </>
  );
}
