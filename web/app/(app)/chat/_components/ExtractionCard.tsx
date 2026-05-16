"use client";

import { useState } from "react";
import { Sparkles, ChevronDown, ChevronUp, Image as ImageIcon, Link2 } from "lucide-react";
import { AiMessage } from "./AiMessage";
import { PersonaSelector } from "./PersonaSelector";
import type { Database } from "@/lib/db/types";

type PersonaRow = Database["public"]["Tables"]["personas"]["Row"];
type Media = { cloudinary_url: string; cloudinary_id: string };

type Props = {
  title: string;
  text: string;
  media: Media[];
  platforms: ("linkedin" | "x")[];
  connectedPlatforms: ("linkedin" | "x")[];
  onTogglePlatform: (p: "linkedin" | "x") => void;
  onGenerate: () => void;
  generationError?: string;
  generated?: boolean;
  personas?: PersonaRow[];
  selectedPersonaIds?: string[];
  onTogglePersona?: (id: string) => void;
};

const PLATFORM_CONFIG = {
  linkedin: {
    label: "LinkedIn",
    active: "bg-[#0077b5] border-[#0077b5] text-white",
    inactive: "border-slate-200 text-slate-500 hover:border-[#0077b5] hover:text-[#0077b5]",
    icon: (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  x: {
    label: "X / Twitter",
    active: "bg-slate-900 border-slate-900 text-white",
    inactive: "border-slate-200 text-slate-500 hover:border-slate-900 hover:text-slate-900",
    icon: (
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    ),
  },
} as const;

export function ExtractionCard({
  title,
  text,
  media,
  platforms,
  connectedPlatforms,
  onTogglePlatform,
  onGenerate,
  generationError,
  generated,
  personas,
  selectedPersonaIds,
  onTogglePersona,
}: Props) {
  const [showMore, setShowMore] = useState(false);
  const truncated = text.length > 320;
  const displayText = truncated && !showMore ? text.slice(0, 320) + "…" : text;

  return (
    <AiMessage noPadding>
      {/* Extracted content */}
      <div className="px-4 pt-3.5 pb-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-400">
          Content extracted
        </p>
        {title && (
          <p className="mb-1.5 text-sm font-bold text-slate-900 leading-snug">{title}</p>
        )}
        {text && (
          <div>
            <p className="text-sm leading-relaxed text-slate-600">{displayText}</p>
            {truncated && (
              <button
                className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-indigo-500 hover:text-indigo-700 transition"
                onClick={() => setShowMore((v) => !v)}
              >
                {showMore ? (
                  <><ChevronUp className="h-3 w-3" /> Show less</>
                ) : (
                  <><ChevronDown className="h-3 w-3" /> Show more</>
                )}
              </button>
            )}
          </div>
        )}
        {media.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <ImageIcon className="h-3 w-3 text-slate-400" />
            <span className="text-[11px] text-slate-400">{media.length} image{media.length !== 1 ? "s" : ""}</span>
            <div className="flex gap-1.5 ml-1">
              {media.slice(0, 3).map((m) => (
                <a key={m.cloudinary_id} href={m.cloudinary_url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.cloudinary_url}
                    alt=""
                    className="h-10 w-10 rounded-lg border border-slate-200 object-cover"
                  />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Generate section */}
      {!generated && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 rounded-b-2xl rounded-bl-sm">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            Generate for
          </p>
          {personas && personas.length > 1 && selectedPersonaIds && onTogglePersona && (
            <PersonaSelector
              personas={personas}
              selectedIds={selectedPersonaIds}
              onToggle={onTogglePersona}
            />
          )}

          {connectedPlatforms.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              <p className="text-xs text-amber-700">
                No platforms connected.{" "}
                <a href="/settings/connections" className="font-semibold underline hover:text-amber-900">
                  Connect LinkedIn or X
                </a>{" "}
                to generate posts.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {(["linkedin", "x"] as const).map((p) => {
                const cfg = PLATFORM_CONFIG[p];
                const connected = connectedPlatforms.includes(p);
                const active = platforms.includes(p);
                if (!connected) {
                  return (
                    <a
                      key={p}
                      href="/settings/connections"
                      className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-200 px-3 py-1.5 text-[11px] font-bold text-slate-400 transition hover:border-slate-400"
                      title={`Connect ${cfg.label} to generate`}
                    >
                      {cfg.icon}
                      {cfg.label}
                      <span className="text-[10px] font-normal">· not connected</span>
                    </a>
                  );
                }
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onTogglePlatform(p)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold transition ${
                      active ? cfg.active : cfg.inactive
                    }`}
                  >
                    {cfg.icon}
                    {cfg.label}
                  </button>
                );
              })}

              <button
                onClick={onGenerate}
                disabled={platforms.length === 0}
                className="ml-auto flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-40"
              >
                <Sparkles className="h-3 w-3" />
                Generate
              </button>
            </div>
          )}
          {generationError && (
            <p className="mt-2 text-xs text-red-500">{generationError}</p>
          )}
        </div>
      )}

      {generated && (
        <div className="border-t border-slate-100 px-4 py-2 rounded-b-2xl rounded-bl-sm">
          <p className="text-[11px] font-medium text-emerald-600">✓ Posts generated below</p>
        </div>
      )}
    </AiMessage>
  );
}
