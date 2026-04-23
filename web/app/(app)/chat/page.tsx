"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";

// ─── Types ────────────────────────────────────────────────────────────────────

type IngestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "success";
      jobId: string;
      title: string;
      text: string;
      media: { cloudinary_url: string; cloudinary_id: string }[];
    };

type GenerateState =
  | { kind: "idle" }
  | { kind: "loading"; stage: string }
  | { kind: "error"; message: string }
  | {
      kind: "success";
      variants: { id: string; platform: string; body: string }[];
    };

const STAGE_LABELS: Record<string, string> = {
  analyzing: "Analyzing content…",
  generating: "Writing posts…",
  storing: "Saving drafts…",
  done: "Done!",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [ingest, setIngest] = useState<IngestState>({ kind: "idle" });
  const [gen, setGen] = useState<GenerateState>({ kind: "idle" });
  const [showMore, setShowMore] = useState(false);
  const [platforms, setPlatforms] = useState<("linkedin" | "x")[]>(["linkedin"]);
  const channelRef = useRef<object | null>(null);

  // Subscribe to job stage changes while generating
  useEffect(() => {
    if (ingest.kind !== "success" || gen.kind !== "loading") return;

    const supabase = createBrowserSupabase();
    const jobId = ingest.jobId;

    const channel = supabase
      .channel(`gen-${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ingestion_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          const stage = (payload.new as { stage: string }).stage;
          setGen((prev) =>
            prev.kind === "loading" ? { kind: "loading", stage } : prev
          );
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [ingest, gen.kind]);

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    const isUrl =
      input.trim().startsWith("http://") || input.trim().startsWith("https://");
    setIngest({ kind: "loading" });
    setGen({ kind: "idle" });
    setShowMore(false);

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: isUrl ? "url" : "text",
          ...(isUrl
            ? { source_url: input.trim() }
            : { source_text: input.trim() }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setIngest({ kind: "error", message: data.error ?? "Extraction failed." });
        return;
      }
      setIngest({
        kind: "success",
        jobId: data.job_id,
        title: data.extracted_title,
        text: data.extracted_text,
        media: data.media,
      });
    } catch {
      setIngest({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleGenerate() {
    if (ingest.kind !== "success") return;
    if (platforms.length === 0) return;

    setGen({ kind: "loading", stage: "analyzing" });

    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingestion_job_id: ingest.jobId,
          platforms,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGen({ kind: "error", message: data.error ?? "Generation failed." });
        return;
      }
      setGen({ kind: "success", variants: data.variants });
    } catch {
      setGen({ kind: "error", message: "Network error. Please try again." });
    }
  }

  function togglePlatform(p: "linkedin" | "x") {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  const isExtractionLoading = ingest.kind === "loading";
  const isGenerationLoading = gen.kind === "loading";
  const extractionDone = ingest.kind === "success";

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 space-y-8">
      <h1 className="text-2xl font-semibold">New post</h1>

      {/* ── Extraction form ── */}
      <form onSubmit={handleIngest} className="space-y-3">
        <textarea
          className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Paste a URL or describe what you want to post about…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isExtractionLoading || isGenerationLoading}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleIngest(e as unknown as React.FormEvent);
            }
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isExtractionLoading || isGenerationLoading || !input.trim()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {isExtractionLoading ? "Extracting…" : "Extract"}
          </button>
          <span className="text-xs text-muted-foreground">⌘+Enter</span>
        </div>
      </form>

      {/* ── Extraction error ── */}
      {ingest.kind === "error" && (
        <p className="text-sm text-destructive">{ingest.message}</p>
      )}

      {/* ── Extraction result ── */}
      {extractionDone && ingest.kind === "success" && (
        <div className="space-y-4 border rounded-lg p-4">
          {ingest.title && (
            <p className="font-semibold text-base">{ingest.title}</p>
          )}

          {ingest.text && (
            <div className="text-sm text-muted-foreground">
              <p>
                {showMore ? ingest.text : ingest.text.slice(0, 400)}
                {ingest.text.length > 400 && !showMore && "…"}
              </p>
              {ingest.text.length > 400 && (
                <button
                  className="text-xs text-primary mt-1 underline"
                  onClick={() => setShowMore((v) => !v)}
                >
                  {showMore ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}

          {ingest.media.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {ingest.media.map((m) => (
                <a
                  key={m.cloudinary_id}
                  href={m.cloudinary_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.cloudinary_url}
                    alt=""
                    className="h-20 w-20 object-cover rounded border"
                  />
                </a>
              ))}
            </div>
          )}

          {/* ── Platform picker + Generate button ── */}
          {(gen.kind === "idle" || gen.kind === "error") && (
            <div className="space-y-3 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Generate for
              </p>
              <div className="flex gap-3">
                {(["linkedin", "x"] as const).map((p) => (
                  <label
                    key={p}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={platforms.includes(p)}
                      onChange={() => togglePlatform(p)}
                      className="rounded"
                    />
                    {p === "linkedin" ? "LinkedIn" : "X / Twitter"}
                  </label>
                ))}
              </div>
              {gen.kind === "error" && (
                <p className="text-sm text-destructive">{gen.message}</p>
              )}
              <button
                onClick={handleGenerate}
                disabled={platforms.length === 0}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
              >
                Generate post →
              </button>
            </div>
          )}

          {/* ── Generation loading ── */}
          {gen.kind === "loading" && (
            <div className="flex items-center gap-3 pt-2 border-t">
              <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-sm text-muted-foreground">
                {STAGE_LABELS[gen.stage] ?? "Generating…"}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Generated variants ── */}
      {gen.kind === "success" && (
        <div className="space-y-4">
          <p className="text-sm font-medium">Generated drafts</p>
          {gen.variants.map((v) => (
            <div key={v.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {v.platform === "linkedin" ? "LinkedIn" : "X / Twitter"}
                </span>
                <button
                  onClick={() => navigator.clipboard.writeText(v.body)}
                  className="text-xs text-primary underline"
                >
                  Copy
                </button>
              </div>
              <p className="text-sm whitespace-pre-wrap">{v.body}</p>
              <div className="flex gap-2 pt-1 border-t">
                <button
                  disabled
                  title="Coming in Phase 4"
                  className="px-3 py-1 rounded-md border text-xs disabled:opacity-40 cursor-not-allowed"
                >
                  Schedule
                </button>
                <button
                  disabled
                  title="Coming in Phase 4"
                  className="px-3 py-1 rounded-md border text-xs disabled:opacity-40 cursor-not-allowed"
                >
                  Publish now
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() => setGen({ kind: "idle" })}
            className="text-sm text-primary underline"
          >
            Regenerate
          </button>
        </div>
      )}
    </div>
  );
}
