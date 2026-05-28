"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { format, formatDistanceToNow, isToday, isTomorrow } from "date-fns";
import { Clock, ChevronRight, CalendarClock } from "lucide-react";
import Link from "next/link";
import { PostPreviewModal, type QueueItem } from "./PostPreviewModal";

export type QueueListItem = {
  id: string;
  platform: string;
  status: string;
  scheduled_at: string | null;
  body: string;
  created_at: string;
};

function PlatformBadge({ platform }: { platform: string }) {
  if (platform === "linkedin") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#0077b5]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#0077b5]">
        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
        LinkedIn
      </span>
    );
  }
  if (platform === "x") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/8 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700">
        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
        </svg>
        X / Twitter
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
      {platform}
    </span>
  );
}

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "linkedin") {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0077b5] shadow-sm">
        <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      </div>
    );
  }
  if (platform === "x") {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 shadow-sm">
        <svg className="h-4.5 w-4.5 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-400 shadow-sm">
      <span className="text-sm font-bold text-white">?</span>
    </div>
  );
}

function formatScheduled(date: Date): string {
  if (isToday(date)) return `Today, ${format(date, "h:mm a")}`;
  if (isTomorrow(date)) return `Tomorrow, ${format(date, "h:mm a")}`;
  return format(date, "MMM d, h:mm a");
}

function relativeLabel(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true })
    .replace("about ", "")
    .replace("less than a minute", "moments");
}

export function QueueList({
  items,
  emptyTab,
}: {
  items: QueueListItem[];
  emptyTab: "all" | "linkedin" | "x";
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null);

  const handleClose = useCallback(() => {
    setSelectedId(null);
    setSelectedItem(null);
  }, []);

  const handleUpdated = useCallback(() => {
    router.refresh();
  }, [router]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-indigo-200/60 bg-gradient-to-b from-white to-indigo-50/30 px-6 py-16 text-center">
        <div className="relative mb-5">
          <div className="absolute inset-0 rounded-2xl bg-indigo-400/15 blur-xl scale-[2]" />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-xl shadow-indigo-400/30">
            <CalendarClock className="h-7 w-7 text-white" />
          </div>
        </div>
        <h3 className="text-sm font-bold text-slate-800">
          {emptyTab === "all"
            ? "Your queue is empty"
            : `No ${emptyTab === "linkedin" ? "LinkedIn" : "X / Twitter"} posts scheduled`}
        </h3>
        <p className="mt-1.5 max-w-[22ch] text-xs leading-relaxed text-slate-400">
          Generate content in the studio and schedule it to fill your pipeline.
        </p>
        <Link href="/chat">
          <button className="mt-5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-300/40 transition hover:opacity-90 active:scale-[0.97]">
            Open Content Studio
          </button>
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2.5 stagger-children">
        {items.map((variant) => {
          const scheduledDate = variant.scheduled_at
            ? new Date(variant.scheduled_at)
            : null;
          const isSelected = selectedId === variant.id;

          return (
            <button
              key={variant.id}
              onClick={() => {
                setSelectedId(variant.id);
                setSelectedItem({
                  id: variant.id,
                  platform: variant.platform,
                  body: variant.body,
                  status: variant.status,
                  scheduled_at: variant.scheduled_at,
                  created_at: variant.created_at,
                });
              }}
              className={`animate-fade-up group flex w-full items-center gap-4 rounded-2xl border bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 ${
                isSelected
                  ? "border-indigo-300 ring-2 ring-indigo-100"
                  : "border-slate-200/70 hover:border-indigo-200"
              }`}
            >
              <PlatformIcon platform={variant.platform} />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800 group-hover:text-slate-900">
                  {variant.body || "—"}
                </p>
                <div className="mt-1.5 flex items-center gap-2.5">
                  <PlatformBadge platform={variant.platform} />
                  {scheduledDate && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                        <Clock className="h-3 w-3 text-indigo-400" />
                        {formatScheduled(scheduledDate)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                {scheduledDate && (
                  <div className="hidden text-right sm:block">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {relativeLabel(scheduledDate)}
                    </span>
                  </div>
                )}
                <ChevronRight
                  className={`h-4 w-4 transition-colors ${
                    isSelected
                      ? "text-indigo-400"
                      : "text-slate-300 group-hover:text-indigo-400"
                  }`}
                />
              </div>
            </button>
          );
        })}
      </div>

      <PostPreviewModal
        variantId={selectedId}
        initialData={selectedItem}
        onClose={handleClose}
        onUpdated={handleUpdated}
      />
    </>
  );
}
