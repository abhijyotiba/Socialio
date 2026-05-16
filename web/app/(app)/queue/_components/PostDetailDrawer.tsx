"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Save,
  Zap,
  Loader2,
  CheckCheck,
  AlertCircle,
  Trash2,
  Link2,
  FileText,
  ExternalLink,
  CalendarClock,
} from "lucide-react";
import { format } from "date-fns";
import { useNowPlusMinutes } from "@/lib/hooks/useNowPlusMinutes";

const CHAR_LIMITS: Record<string, number> = {
  linkedin: 3000,
  x: 280,
};

const PLATFORM: Record<
  string,
  { label: string; tile: string; glyph: string; ring: string }
> = {
  linkedin: {
    label: "LinkedIn",
    tile: "bg-[#0077b5]",
    glyph: "in",
    ring: "ring-[#0077b5]/20",
  },
  x: {
    label: "X / Twitter",
    tile: "bg-gray-900",
    glyph: "X",
    ring: "ring-gray-900/10",
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

type Props = {
  variantId: string | null;
  onClose: () => void;
  onUpdated: () => void;
};

export function PostDetailDrawer({ variantId, onClose, onUpdated }: Props) {
  const [detail, setDetail] = useState<PostDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const minScheduleTime = useNowPlusMinutes(1);

  // Editable local state
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);

  // Action states
  const [saving, setSaving] = useState(false);
  const [savingMedia, setSavingMedia] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editingTime, setEditingTime] = useState(false);

  // Feedback
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isOpen = variantId !== null;

  // Load details whenever a new variantId comes in.
  // The series of setState calls below resets the form when the prop changes;
  // the alternative (a `key={variantId}` remount in the parent) would be a
  // wider refactor for the same effect, so we keep this and silence the rule.
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
    setLoading(true);
    setDetail(null);
    setFetchError(null);
    setActionError(null);

    fetch(`/api/posts/${variantId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load");
        return r.json() as Promise<PostDetail>;
      })
      .then((d) => {
        setDetail(d);
        setBody(d.body);
        setMedia(d.media);
        setScheduledAt(
          d.scheduled_at
            ? new Date(d.scheduled_at).toISOString().slice(0, 16)
            : ""
        );
      })
      .catch(() => setFetchError("Could not load post details. Please try again."))
      .finally(() => setLoading(false));
  }, [variantId]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 380) + "px";
  }, [body]);

  // Close on Escape
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

  function showError(msg: string) {
    setActionError(msg);
    setSuccessMsg(null);
  }

  const plt = detail
    ? (PLATFORM[detail.platform] ?? {
        label: detail.platform,
        tile: "bg-slate-400",
        glyph: "?",
        ring: "ring-slate-200",
      })
    : null;

  const charLimit = detail ? (CHAR_LIMITS[detail.platform] ?? 3000) : 3000;
  const charCount = body.length;
  const charOver = charCount > charLimit;
  const bodyDirty = detail !== null && body !== detail.body;
  const mediaDirty =
    detail !== null &&
    (media.length !== detail.media.length ||
      media.some((m, i) => detail.media[i]?.id !== m.id));

  const isBusy = saving || savingMedia || rescheduling || cancelling || publishing;

  async function handleSaveBody() {
    if (!detail || !body.trim() || charOver) return;
    setSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/posts/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const d = await res.json();
        showError(d.error ?? "Save failed.");
        return;
      }
      setDetail((p) => (p ? { ...p, body } : p));
      flash("Content saved.");
      onUpdated();
    } catch {
      showError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveMedia() {
    if (!detail) return;
    setSavingMedia(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/posts/${detail.id}/media`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_asset_ids: media.map((m) => m.id) }),
      });
      if (!res.ok) {
        const d = await res.json();
        showError(d.error ?? "Save failed.");
        return;
      }
      setDetail((p) => (p ? { ...p, media } : p));
      flash("Media updated.");
      onUpdated();
    } catch {
      showError("Network error. Please try again.");
    } finally {
      setSavingMedia(false);
    }
  }

  async function handleReschedule() {
    if (!detail || !scheduledAt) return;
    const utcIso = new Date(scheduledAt).toISOString();
    if (new Date(utcIso) <= new Date()) {
      showError("Scheduled time must be in the future.");
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
        showError(d.error ?? "Reschedule failed.");
        return;
      }
      setDetail((p) => (p ? { ...p, scheduled_at: d.scheduled_at } : p));
      setEditingTime(false);
      flash("Rescheduled successfully.");
      onUpdated();
    } catch {
      showError("Network error. Please try again.");
    } finally {
      setRescheduling(false);
    }
  }

  async function handleCancelPost() {
    if (!detail) return;
    setCancelling(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/posts/${detail.id}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json();
        showError(d.error ?? "Cancel failed.");
        return;
      }
      flash("Post cancelled and moved to drafts.");
      onUpdated();
      setTimeout(onClose, 1400);
    } catch {
      showError("Network error. Please try again.");
    } finally {
      setCancelling(false);
    }
  }

  async function handlePublishNow() {
    if (!detail) return;
    setPublishing(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/posts/${detail.id}/publish`, {
        method: "POST",
      });
      const d = await res.json();
      if (!res.ok) {
        showError(d.error ?? "Publish failed.");
        return;
      }
      flash("Published! 🎉");
      onUpdated();
      setTimeout(onClose, 1500);
    } catch {
      showError("Network error. Please try again.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer panel */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-[500px] flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          {plt && detail ? (
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${plt.tile} shadow-md`}
              >
                <span className="text-[15px] font-black text-white">
                  {plt.glyph}
                </span>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {plt.label} Post
                </p>
                <p className="text-[11px] text-slate-400">
                  {detail.scheduled_at
                    ? `Scheduled · ${format(new Date(detail.scheduled_at), "MMM d, h:mm a")}`
                    : "Draft"}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-slate-100 animate-pulse" />
              <div className="space-y-1.5">
                <div className="h-3.5 w-28 rounded bg-slate-100 animate-pulse" />
                <div className="h-2.5 w-20 rounded bg-slate-100 animate-pulse" />
              </div>
            </div>
          )}
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {/* ── Scrollable body ────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
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
                onClick={() => {
                  /* re-trigger by toggling — parent handles this */
                  onClose();
                }}
                className="mt-3 text-xs font-medium text-indigo-600 hover:underline"
              >
                Close and retry
              </button>
            </div>
          )}

          {!loading && !fetchError && detail && (
            <div className="divide-y divide-slate-100">

              {/* ── Post content ─────────────────────────────── */}
              <section className="px-6 py-5">
                <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Post Content
                </label>
                <textarea
                  ref={textareaRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={isBusy}
                  className={`w-full resize-none rounded-2xl border px-4 py-3 text-sm leading-relaxed text-slate-800 transition-all placeholder:text-slate-400 focus:outline-none focus:ring-2 disabled:opacity-60 ${
                    charOver
                      ? "border-red-300 bg-red-50/40 focus:border-red-400 focus:ring-red-100"
                      : "border-slate-200 bg-slate-50/60 focus:border-indigo-400 focus:bg-white focus:ring-indigo-100"
                  }`}
                  rows={4}
                />
                <div className="mt-2 flex items-center justify-between">
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
                  {bodyDirty && (
                    <button
                      onClick={handleSaveBody}
                      disabled={isBusy || charOver || !body.trim()}
                      className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
                    >
                      {saving ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      Save changes
                    </button>
                  )}
                </div>
              </section>

              {/* ── Scheduled time ───────────────────────────── */}
              <section className="px-6 py-5">
                <label className="mb-3 block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Scheduled Time
                </label>
                {!editingTime ? (
                  <div className="flex items-center gap-3">
                    <div className="flex flex-1 items-center gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                      <CalendarClock className="h-4 w-4 shrink-0 text-indigo-500" />
                      <span className="text-sm font-semibold text-slate-700">
                        {detail.scheduled_at
                          ? format(
                              new Date(detail.scheduled_at),
                              "EEEE, MMM d · h:mm a"
                            )
                          : "Not scheduled"}
                      </span>
                    </div>
                    <button
                      onClick={() => setEditingTime(true)}
                      disabled={isBusy}
                      className="shrink-0 rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      min={minScheduleTime}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleReschedule}
                        disabled={!scheduledAt || rescheduling}
                        className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
                      >
                        {rescheduling ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <CheckCheck className="h-3 w-3" />
                        )}
                        Confirm
                      </button>
                      <button
                        onClick={() => {
                          setEditingTime(false);
                          setScheduledAt(
                            detail.scheduled_at
                              ? new Date(detail.scheduled_at)
                                  .toISOString()
                                  .slice(0, 16)
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
              </section>

              {/* ── Attached media ───────────────────────────── */}
              <section className="px-6 py-5">
                <div className="mb-3 flex items-center justify-between">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Attached Media
                    {media.length > 0 && (
                      <span className="ml-1.5 text-slate-300">
                        ({media.length}/4)
                      </span>
                    )}
                  </label>
                  {mediaDirty && (
                    <button
                      onClick={handleSaveMedia}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40"
                    >
                      {savingMedia ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3" />
                      )}
                      Save
                    </button>
                  )}
                </div>

                {media.length === 0 ? (
                  <p className="text-sm text-slate-400">No media attached to this post.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {media.map((m) => (
                      <div key={m.id} className="group relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={m.cloudinary_url}
                          alt=""
                          className="h-24 w-24 rounded-2xl border border-slate-200 object-cover transition group-hover:brightness-90"
                        />
                        <button
                          onClick={() =>
                            setMedia((prev) =>
                              prev.filter((x) => x.id !== m.id)
                            )
                          }
                          disabled={isBusy}
                          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow-md opacity-0 transition group-hover:opacity-100 disabled:opacity-40"
                          aria-label="Remove image"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── Original source ──────────────────────────── */}
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

        {/* ── Footer actions ──────────────────────────────────── */}
        {detail && (
          <div className="shrink-0 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
            {/* Feedback banners */}
            {successMsg && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 animate-message-in">
                <CheckCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                <p className="text-sm font-medium text-emerald-700">
                  {successMsg}
                </p>
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

            <div className="flex items-center gap-2.5">
              <button
                onClick={handleCancelPost}
                disabled={isBusy}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
              >
                {cancelling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Cancel post
              </button>

              <button
                onClick={handlePublishNow}
                disabled={isBusy}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-indigo-200/60 transition hover:opacity-95 disabled:opacity-40"
              >
                {publishing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                Publish Now
              </button>
            </div>

            <p className="mt-2.5 text-center text-[10px] text-slate-400">
              Press <kbd className="rounded bg-slate-200 px-1 py-0.5 font-mono text-[10px]">Esc</kbd> to close
            </p>
          </div>
        )}
      </div>
    </>
  );
}
