import type { ReactNode } from "react";

const PLATFORM: Record<string, { label: string; bg: string; text: string; icon: ReactNode }> = {
  linkedin: {
    label: "LinkedIn",
    bg: "bg-[#0077b5]",
    text: "text-[#0077b5]",
    icon: (
      <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  x: {
    label: "X / Twitter",
    bg: "bg-slate-900",
    text: "text-slate-700",
    icon: (
      <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    ),
  },
};

export function PlatformChip({ platform }: { platform: string }) {
  const cfg = PLATFORM[platform];
  if (!cfg) {
    return (
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-700">
        {platform}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className={`flex h-6 w-6 items-center justify-center rounded-md ${cfg.bg}`}>
        {cfg.icon}
      </span>
      <span className={`text-[11px] font-bold uppercase tracking-[0.12em] ${cfg.text}`}>
        {cfg.label}
      </span>
    </span>
  );
}
