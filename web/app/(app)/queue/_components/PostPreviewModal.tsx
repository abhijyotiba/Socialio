"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Clock,
  Zap,
  Loader2,
  CheckCheck,
  AlertCircle,
  Trash2,
  Link2,
  FileText,
  ExternalLink,
  CalendarClock,
  ThumbsUp,
  MessageSquare,
  Repeat2,
  Send,
  Heart,
  BarChart2,
  Bookmark,
  UploadCloud,
} from "lucide-react";
import { format } from "date-fns";
import { useNowPlusMinutes } from "@/lib/hooks/useNowPlusMinutes";

const CHAR_LIMITS: Record<string, number> = {
  linkedin: 3000,
  x: 280,
};

const PLATFORM: Record<
  string,
  { label: string; tile: string; ring: string; icon: React.ReactNode }
> = {
  linkedin: {
    label: "LinkedIn",
    tile: "bg-[#0077b5]",
    ring: "ring-[#0077b5]/20",
    icon: (
      <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
      </svg>
    ),
  },
  x: {
    label: "X / Twitter",
    tile: "bg-slate-900",
    ring: "ring-slate-900/10",
    icon: (
      <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
      </svg>
    ),
  },
};

type MediaItem = {
  id: string;
  cloudinary_url: string;
  resource_type: string;
};

type Source = {
  type: string;
  url?: string;
  text?: string;
  title?: string;
};

type PostDetail = {
  id: string;
  platform: string;
  body: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  media: MediaItem[];
  source: Source | null;
};

// Subset the queue page already has — passed in so the modal renders instantly
export type QueueItem = {
  id: string;
  platform: string;
  body: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
};

type Props = {
  variantId: string | null;
  initialData?: QueueItem | null;
  onClose: () => void;
  onUpdated: () => void;
};

// ── Platform preview shells ────────────────────────────────────────────────

function LinkedInPreview({ body, media }: { body: string; media: MediaItem[] }) {
  const formatted = body.replace(/(#\w+)/g, '<span class="text-[#0077b5]">$1</span>');
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Author row */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0077b5] to-[#0059a0] text-base font-bold text-white shadow-sm">
          A
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold text-slate-900 leading-tight">Your Name</p>
          <p className="mt-0.5 text-[11.5px] text-slate-400 leading-tight truncate">
            Your headline · 1st
          </p>
          <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
            <Clock className="h-3 w-3" />
            <span>Scheduled</span>
            <span>·</span>
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
          </div>
        </div>
        <div className="shrink-0">
          <div className="flex items-center gap-1 rounded-full border border-[#0077b5] px-3 py-1 text-[11px] font-semibold text-[#0077b5]">
            <span>+</span> Follow
          </div>
        </div>
      </div>

      {/* Body */}
      <div
        className="px-4 pb-3 text-[13.5px] leading-relaxed text-slate-800 whitespace-pre-wrap"
        dangerouslySetInnerHTML={{ __html: formatted }}
      />

      {/* Media */}
      {media.length > 0 && (
        <div className={`grid gap-0.5 ${media.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {media.slice(0, 4).map((m, i) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={m.id}
              src={m.cloudinary_url}
              alt=""
              className={`w-full object-cover ${
                media.length === 1 ? "max-h-64" : "h-36"
              } ${i === 0 && media.length === 3 ? "col-span-2" : ""}`}
            />
          ))}
        </div>
      )}

      {/* Reaction bar */}
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2">
        <div className="flex items-center gap-1 text-[11.5px] text-slate-400">
          <span className="flex -space-x-0.5">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#0077b5] text-[9px]">👍</span>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#e04d39] text-[9px]">❤️</span>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#f5c842] text-[9px]">💡</span>
          </span>
          <span className="ml-1">Be the first to react</span>
        </div>
        <span className="text-[11.5px] text-slate-400">0 comments</span>
      </div>

      {/* Action bar */}
      <div className="flex border-t border-slate-100">
        {[
          { icon: ThumbsUp, label: "Like" },
          { icon: MessageSquare, label: "Comment" },
          { icon: Repeat2, label: "Repost" },
          { icon: Send, label: "Send" },
        ].map(({ icon: Icon, label }) => (
          <button
            key={label}
            className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[12px] font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function XPreview({ body, media }: { body: string; media: MediaItem[] }) {
  const charLimit = 280;
  const formatted = body.replace(/(#\w+)/g, '<span class="text-[#1d9bf0]">$1</span>');
  const isOver = body.length > charLimit;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex gap-3 p-4">
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#1d9bf0] to-[#0d6ebd] text-sm font-bold text-white shadow-sm">
          A
        </div>

        <div className="flex-1 min-w-0">
          {/* Author */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[14px] font-bold text-slate-900">Your Name</span>
            <svg className="h-4 w-4 text-[#1d9bf0] shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91-1.01-1.01-2.52-1.27-3.91-.81-.67-1.31-1.91-2.19-3.34-2.19-1.43 0-2.67.88-3.33 2.19-1.4-.46-2.91-.2-3.92.81-1.01 1.01-1.27 2.52-.8 3.91C2.88 9.33 2 10.57 2 12c0 1.43.88 2.67 2.19 3.34-.46 1.39-.2 2.9.81 3.91 1.01 1.01 2.52 1.27 3.91.81.67 1.31 1.91 2.19 3.34 2.19 1.43 0 2.67-.88 3.33-2.19 1.4.46 2.91.2 3.92-.81 1.01-1.01 1.27-2.52.8-3.91C21.32 14.67 22.25 13.43 22.25 12zM9 17.5l-4.5-4.5 1.41-1.41L9 14.67l9.09-9.09 1.41 1.41L9 17.5z" />
            </svg>
            <span className="text-[13.5px] text-slate-400">@yourhandle</span>
            <span className="text-slate-300">·</span>
            <span className="text-[13.5px] text-slate-400">now</span>
          </div>

          {/* Body */}
          <div
            className={`mt-1 text-[14.5px] leading-[1.55] whitespace-pre-wrap ${isOver ? "text-red-500" : "text-slate-900"}`}
            dangerouslySetInnerHTML={{ __html: formatted }}
          />

          {/* Media */}
          {media.length > 0 && (
            <div className={`mt-3 grid gap-0.5 overflow-hidden rounded-2xl border border-slate-100 ${media.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {media.slice(0, 4).map((m) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={m.id}
                  src={m.cloudinary_url}
                  alt=""
                  className={`w-full object-cover ${media.length === 1 ? "max-h-56" : "h-32"}`}
                />
              ))}
            </div>
          )}

          {/* Char indicator */}
          {body.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="relative h-4 w-4">
                <svg className="h-4 w-4 -rotate-90" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="6" fill="none" stroke="#e2e8f0" strokeWidth="2" />
                  <circle
                    cx="8" cy="8" r="6"
                    fill="none"
                    stroke={isOver ? "#ef4444" : body.length > 252 ? "#f59e0b" : "#1d9bf0"}
                    strokeWidth="2"
                    strokeDasharray={`${Math.min((body.length / charLimit) * 37.7, 37.7)} 37.7`}
                  />
                </svg>
              </div>
              <span className={`text-[11px] font-semibold tabular-nums ${isOver ? "text-red-500" : "text-slate-400"}`}>
                {charLimit - body.length}
              </span>
            </div>
          )}

          {/* Actions */}
          <div className="mt-3 flex items-center justify-between text-slate-400">
            {[
              { icon: MessageSquare, label: "Reply" },
              { icon: Repeat2, label: "Repost" },
              { icon: Heart, label: "Like", hover: "hover:text-[#f91880]" },
              { icon: BarChart2, label: "Views" },
              { icon: Bookmark, label: "Save" },
            ].map(({ icon: Icon, label, hover }) => (
              <button
                key={label}
                className={`flex items-center gap-1.5 rounded-full p-1.5 text-[12px] transition hover:bg-slate-100 hover:text-[#1d9bf0] ${hover ?? ""}`}
                title={label}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────

export function PostPreviewModal({ variantId, initialData, onClose, onUpdated }: Props) {
  const [detail, setDetail] = useState<PostDetail | null>(null);
  // tracks whether the background extras fetch is still in flight
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const minScheduleTime = useNowPlusMinutes(1);

  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [previewTab, setPreviewTab] = useState<string>("linkedin");

  const [saving, setSaving] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editingTime, setEditingTime] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // savedMedia mirrors what's actually persisted on the server
  // media is the local working copy (may have unsaved changes)
  const [savedMedia, setSavedMedia] = useState<MediaItem[]>([]);

  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isOpen = variantId !== null;

  // Reset form when a new variantId comes in. Same trade-off as the drawer:
  // a `key={variantId}` remount in the parent would be a wider refactor for
  // the same effect.
  useEffect(() => {
    if (!variantId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- form reset on prop change
      setDetail(null);
      setBody("");
      setScheduledAt("");
      setMedia([]);
      setSuccessMsg(null);
      setActionError(null);
      setEditingTime(false);
      setFetchError(null);
      return;
    }

    setFetchError(null);
    setActionError(null);
    setMedia([]);
    setSavedMedia([]);

    // Render instantly from queue data — no waiting for the API
    if (initialData) {
      const stub: PostDetail = {
        ...initialData,
        media: [],
        source: null,
      };
      setDetail(stub);
      setBody(initialData.body);
      setPreviewTab(initialData.platform);
      setScheduledAt(
        initialData.scheduled_at
          ? new Date(initialData.scheduled_at).toISOString().slice(0, 16)
          : ""
      );
    }

    // Fetch only media + source in background (two parallel calls)
    setExtrasLoading(true);
    fetch(`/api/posts/${variantId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json() as Promise<PostDetail>;
      })
      .then((d) => {
        setDetail(d);
        setMedia(d.media);
        setSavedMedia(d.media);
        // Only overwrite body/schedule if we had no initialData (edge case)
        if (!initialData) {
          setBody(d.body);
          setPreviewTab(d.platform);
          setScheduledAt(
            d.scheduled_at
              ? new Date(d.scheduled_at).toISOString().slice(0, 16)
              : ""
          );
        }
      })
      .catch(() => {
        if (!initialData) setFetchError("Could not load post details. Please try again.");
        // If we already rendered from initialData, extras silently fail — not fatal
      })
      .finally(() => setExtrasLoading(false));
  }, [variantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 300) + "px";
  }, [body]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  function flash(msg: string) {
    setSuccessMsg(msg);
    setActionError(null);
    setTimeout(() => setSuccessMsg(null), 3000);
  }

  const plt = detail
    ? (PLATFORM[detail.platform] ?? {
        label: detail.platform,
        tile: "bg-slate-400",
        ring: "ring-slate-200",
        icon: <span className="text-white text-xs font-bold">?</span>,
      })
    : null;

  const charLimit = detail ? (CHAR_LIMITS[detail.platform] ?? 3000) : 3000;
  const charCount = body.length;
  const charOver = charCount > charLimit;
  const bodyDirty = detail !== null && body !== detail.body;
  const mediaDirty =
    media.length !== savedMedia.length ||
    media.some((m, i) => savedMedia[i]?.id !== m.id);
  const hasDraft = bodyDirty || mediaDirty;
  const isBusy = saving || rescheduling || cancelling || publishing;

  async function handleSaveDraft() {
    if (!detail || charOver || !body.trim()) return;
    setSaving(true);
    setActionError(null);
    try {
      // Run body + media saves in parallel when both are dirty
      const ops: Promise<Response>[] = [];

      if (bodyDirty) {
        ops.push(
          fetch(`/api/posts/${detail.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
          })
        );
      }

      if (mediaDirty) {
        ops.push(
          fetch(`/api/posts/${detail.id}/media`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ media_asset_ids: media.map((m) => m.id) }),
          })
        );
      }

      const results = await Promise.all(ops);
      const failed = results.find((r) => !r.ok);
      if (failed) {
        const d = await failed.json();
        setActionError(d.error ?? "Save failed.");
        return;
      }

      setDetail((p) => (p ? { ...p, body, media } : p));
      setSavedMedia(media);
      flash("Draft saved.");
      onUpdated();
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReschedule() {
    if (!detail || !scheduledAt) return;
    const utcIso = new Date(scheduledAt).toISOString();
    if (new Date(utcIso) <= new Date()) {
      setActionError("Scheduled time must be in the future.");
      return;
    }
    setRescheduling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/posts/${detail.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: utcIso }),
      });
      const d = await res.json();
      if (!res.ok) {
        setActionError(d.error ?? "Reschedule failed.");
        return;
      }
      setDetail((p) => (p ? { ...p, scheduled_at: d.scheduled_at } : p));
      setEditingTime(false);
      flash("Rescheduled successfully.");
      onUpdated();
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setRescheduling(false);
    }
  }

  async function handleCancelPost() {
    if (!detail) return;
    setCancelling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/posts/${detail.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        setActionError(d.error ?? "Cancel failed.");
        return;
      }
      flash("Post cancelled and moved to drafts.");
      onUpdated();
      setTimeout(onClose, 1400);
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  async function handlePublishNow() {
    if (!detail) return;
    setPublishing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/posts/${detail.id}/publish`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) {
        setActionError(d.error ?? "Publish failed.");
        return;
      }
      flash("Published successfully!");
      onUpdated();
      setTimeout(onClose, 1500);
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setPublishing(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !detail) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File exceeds 10 MB limit.");
      return;
    }
    if (media.length >= 4) {
      setUploadError("Maximum 4 images per post.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/media/upload", { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) {
        setUploadError(uploadData.error ?? "Upload failed.");
        return;
      }
      // Asset is now in Cloudinary + media_assets table, but NOT yet linked to this post.
      // Link happens on Save Draft.
      const newAsset: MediaItem = uploadData.asset;
      setMedia((prev) => [...prev, newAsset]);
    } catch {
      setUploadError("Network error during upload.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleRemoveMedia(assetId: string) {
    // Local state only — persisted on Save Draft
    setMedia((prev) => prev.filter((m) => m.id !== assetId));
  }

  // Platforms this post has (currently just the one it was generated for,
  // but the tab strip is architected to support more in the future)
  const previewPlatforms = detail ? [detail.platform] : [];

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-200 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${
          isOpen ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-[0.97]"
        }`}
        onClick={onClose}
      >
        <div
          className="relative flex h-[88vh] max-h-[820px] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/10"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button — top-right of the whole modal */}
          <button
            onClick={onClose}
            className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
          {/* ── LEFT: Edit panel ──────────────────────────────── */}
          <div className="flex w-[44%] shrink-0 flex-col border-r border-slate-100">

            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
              {plt && detail ? (
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${plt.tile} shadow-md`}>
                    {plt.icon}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{plt.label} Post</p>
                    <p className="text-[11px] text-slate-400">
                      {detail.scheduled_at
                        ? `Scheduled · ${format(new Date(detail.scheduled_at), "MMM d, h:mm a")}`
                        : "Draft"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 animate-pulse rounded-xl bg-slate-100" />
                  <div className="space-y-1.5">
                    <div className="h-3.5 w-28 animate-pulse rounded bg-slate-100" />
                    <div className="h-2.5 w-20 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable body */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* Full blank loading only when we have no initialData at all */}
              {!detail && !fetchError && (
                <div className="flex h-48 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
                </div>
              )}

              {!detail && fetchError && (
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

              {detail && (
                <div className="divide-y divide-slate-100">

                  {/* Post content — fixed height so it stays uniform across platforms */}
                  <section className="px-6 py-5">
                    <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Post Content
                    </label>
                    <textarea
                      ref={textareaRef}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      disabled={isBusy}
                      className={`h-40 w-full resize-none rounded-2xl border px-4 py-3 text-sm leading-relaxed text-slate-800 transition-all placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:opacity-60 ${
                        charOver
                          ? "border-red-300 bg-red-50/40 focus:border-red-400 focus:ring-red-100"
                          : "border-slate-200 bg-slate-50/60 focus:border-indigo-400 focus:bg-white focus:ring-indigo-100"
                      }`}
                    />
                    <div className="mt-2 flex items-center justify-end">
                      <span
                        className={`text-[11px] font-semibold tabular-nums ${
                          charOver
                            ? "text-red-500"
                            : charCount > charLimit * 0.85
                            ? "text-amber-500"
                            : "text-slate-400"
                        }`}
                      >
                        {charCount.toLocaleString()} / {charLimit.toLocaleString()}
                      </span>
                    </div>
                  </section>

                  {/* Attached media */}
                  <section className="px-6 py-5">
                    <div className="mb-3 flex items-center justify-between">
                      <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Attached Media
                        <span className="ml-1.5 text-slate-300">({media.length}/4)</span>
                      </label>
                    </div>

                    {uploadError && (
                      <p className="mb-2 text-xs text-red-500">{uploadError}</p>
                    )}

                    <div className="flex flex-wrap gap-3">
                      {/* Upload tile — always first, hidden once 4 images attached */}
                      {media.length < 4 && (
                        <label className={`flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 transition hover:border-indigo-400 hover:bg-indigo-50/40 ${uploading ? "cursor-not-allowed opacity-60" : ""}`}>
                          {uploading ? (
                            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                          ) : (
                            <>
                              <UploadCloud className="h-5 w-5 text-slate-400" />
                              <span className="text-[10px] font-medium text-slate-400">Upload</span>
                            </>
                          )}
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            onChange={handleFileUpload}
                            disabled={uploading || isBusy}
                          />
                        </label>
                      )}

                      {/* Attached images */}
                      {media.map((m) => (
                        <div key={m.id} className="group relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={m.cloudinary_url}
                            alt=""
                            className="h-20 w-20 rounded-xl border border-slate-200 object-cover transition group-hover:brightness-90"
                          />
                          <button
                            onClick={() => handleRemoveMedia(m.id)}
                            disabled={isBusy || uploading}
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-md opacity-0 transition group-hover:opacity-100 disabled:opacity-40"
                            aria-label="Remove image"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}

                      {/* Skeleton placeholders while extras load */}
                      {extrasLoading && media.length === 0 && (
                        <>
                          <div className="h-20 w-20 animate-pulse rounded-xl bg-slate-100" />
                          <div className="h-20 w-20 animate-pulse rounded-xl bg-slate-100" />
                        </>
                      )}
                    </div>
                  </section>

                  {/* Original source */}
                  {detail.source && (
                    <section className="px-6 py-5">
                      <label className="mb-2.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Original Source
                      </label>
                      {detail.source.type === "url" && detail.source.url ? (
                        <a
                          href={detail.source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-indigo-600 transition hover:border-indigo-200 hover:bg-indigo-50"
                        >
                          <Link2 className="h-3.5 w-3.5 shrink-0" />
                          <span className="flex-1 truncate text-sm">
                            {detail.source.title || detail.source.url}
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        </a>
                      ) : (
                        <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <p className="line-clamp-3 text-sm text-slate-600">
                            {detail.source.text ?? "—"}
                          </p>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )}
            </div>

            {/* Footer actions */}
            {detail && (
              <div className="shrink-0 border-t border-slate-100 bg-slate-50/60 px-6 py-4">

                {/* Scheduled time — lives in the footer above action buttons */}
                <div className="mb-3">
                  <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Scheduled Time
                  </label>
                  {!editingTime ? (
                    <div className="flex items-center gap-2">
                      <div className="flex flex-1 items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2">
                        <CalendarClock className="h-3.5 w-3.5 shrink-0 text-indigo-500" />
                        <span className="text-xs font-semibold text-slate-700">
                          {detail.scheduled_at
                            ? format(new Date(detail.scheduled_at), "EEEE, MMM d · h:mm a")
                            : "Not scheduled"}
                        </span>
                      </div>
                      <button
                        onClick={() => setEditingTime(true)}
                        disabled={isBusy}
                        className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
                      >
                        Change
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        min={minScheduleTime}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleReschedule}
                          disabled={!scheduledAt || rescheduling}
                          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
                        >
                          {rescheduling ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
                          Confirm
                        </button>
                        <button
                          onClick={() => {
                            setEditingTime(false);
                            setScheduledAt(
                              detail.scheduled_at
                                ? new Date(detail.scheduled_at).toISOString().slice(0, 16)
                                : ""
                            );
                          }}
                          className="text-xs font-medium text-slate-400 hover:text-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {successMsg && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 animate-message-in">
                    <CheckCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                    <p className="text-sm font-medium text-emerald-700">{successMsg}</p>
                  </div>
                )}
                {actionError && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 animate-message-in">
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                    <p className="text-sm text-red-600">{actionError}</p>
                    <button
                      className="ml-auto shrink-0 text-xs font-medium text-slate-400 hover:text-slate-600"
                      onClick={() => setActionError(null)}
                    >
                      Dismiss
                    </button>
                  </div>
                )}
                {/* Save Draft — only visible when there are unsaved changes */}
                {hasDraft && (
                  <button
                    onClick={handleSaveDraft}
                    disabled={charOver || isBusy}
                    className="mb-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-40"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCheck className="h-3.5 w-3.5" />
                    )}
                    Save Draft
                  </button>
                )}

                <div className="flex items-center gap-2.5">
                  <button
                    onClick={handleCancelPost}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  >
                    {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Cancel post
                  </button>
                  <button
                    onClick={handlePublishNow}
                    disabled={isBusy}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-200/60 transition hover:opacity-95 disabled:opacity-40"
                  >
                    {publishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    Publish Now
                  </button>
                </div>
                <p className="mt-2.5 text-center text-[10px] text-slate-400">
                  Press{" "}
                  <kbd className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[10px]">Esc</kbd>{" "}
                  to close
                </p>
              </div>
            )}
          </div>

          {/* ── RIGHT: Preview panel ──────────────────────────── */}
          <div className="flex flex-1 flex-col bg-slate-50/60">

            {/* Preview header + tabs */}
            <div className="shrink-0 border-b border-slate-100 bg-white px-6 py-3">
              <div className="flex items-center gap-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Live Preview
                </p>
                {/* Platform tab strip — left-aligned beside the label */}
                {previewPlatforms.length > 0 && (
                  <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-0.5">
                    {previewPlatforms.map((platform) => {
                      const p = PLATFORM[platform];
                      if (!p) return null;
                      const isActive = previewTab === platform;
                      return (
                        <button
                          key={platform}
                          onClick={() => setPreviewTab(platform)}
                          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all ${
                            isActive
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-500 hover:text-slate-700"
                          }`}
                        >
                          <span className={`flex h-4 w-4 items-center justify-center rounded ${p.tile}`}>
                            {platform === "linkedin" ? (
                              <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                              </svg>
                            ) : (
                              <svg className="h-2 w-2 text-white" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
                              </svg>
                            )}
                          </span>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Preview scroll */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              {detail && (
                <>
                  {previewTab === "linkedin" && (
                    <LinkedInPreview body={body} media={media} />
                  )}
                  {previewTab === "x" && (
                    <XPreview body={body} media={media} />
                  )}
                </>
              )}

              {!detail && !fetchError && (
                <div className="flex h-full items-center justify-center text-sm text-slate-300">
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-300" />
                </div>
              )}
            </div>

            {/* Disclaimer */}
            {detail && (
              <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-3 text-center text-[10px] text-slate-300">
                Preview only — actual formatting may vary slightly on the platform
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
