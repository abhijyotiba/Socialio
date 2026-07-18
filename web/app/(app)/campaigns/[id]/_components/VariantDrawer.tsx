"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, AlertCircle } from "lucide-react";
import { StatusBadge } from "@/components/spine/StatusBadge";
import { VariantCard } from "./VariantCard";

type VariantDetail = {
  id: string;
  platform: string;
  body: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  source: { type: string; url?: string; text?: string; title?: string } | null;
};

type Props = {
  campaignId: string;
  variantId: string | null;
  jobId?: string;
  onClose: () => void;
};

// Portal drawer for spot-editing a single variant (mirrors the createPortal
// pattern in queue/PostPreviewModal). On open it loads the full detail on demand
// and renders the existing VariantCard, which owns publish/schedule/refine/
// history/media. Inline editing does NOT happen in the grid — only here.
export function VariantDrawer({ campaignId, variantId, jobId, onClose }: Props) {
  const [detail, setDetail] = useState<VariantDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const isOpen = variantId !== null;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal SSR mount guard
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!variantId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on prop change
      setDetail(null);
      setFetchError(null);
      return;
    }
    setLoading(true);
    setDetail(null);
    setFetchError(null);
    fetch(`/api/campaigns/${campaignId}/variants/${variantId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json() as Promise<VariantDetail>;
      })
      .then((d) => setDetail(d))
      .catch(() => setFetchError("Could not load this post. Please try again."))
      .finally(() => setLoading(false));
  }, [campaignId, variantId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!mounted) return null;

  return createPortal(
    <>
      <div
        className={`fixed inset-0 z-[9998] bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-200 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />
      <div
        className={`fixed right-0 top-0 z-[9999] flex h-full w-full max-w-[560px] flex-col bg-slate-50 shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex items-center gap-2.5">
            <p className="text-sm font-bold text-slate-900">Review post</p>
            {detail && <StatusBadge status={detail.status} />}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
            </div>
          )}

          {!loading && fetchError && (
            <div className="px-6 py-8 text-center">
              <AlertCircle className="mx-auto h-8 w-8 text-red-400" />
              <p className="mt-3 text-sm text-slate-600">{fetchError}</p>
              <button
                onClick={onClose}
                className="mt-3 text-xs font-medium text-indigo-600 hover:underline"
              >
                Close and retry
              </button>
            </div>
          )}

          {!loading && !fetchError && detail && (
            <VariantCard
              variant={{ id: detail.id, platform: detail.platform, body: detail.body }}
              jobId={jobId}
            />
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-3 text-center text-[10px] text-slate-400">
          Press{" "}
          <kbd className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[10px]">
            Esc
          </kbd>{" "}
          to close
        </div>
      </div>
    </>,
    document.body
  );
}
