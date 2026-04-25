"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { VariantCard } from "./_components/VariantCard";
import { Loader2, Sparkles, Link2, Type } from "lucide-react";

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

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [ingest, setIngest] = useState<IngestState>({ kind: "idle" });
  const [gen, setGen] = useState<GenerateState>({ kind: "idle" });
  const [showMore, setShowMore] = useState(false);
  const [platforms, setPlatforms] = useState<("linkedin" | "x")[]>(["linkedin"]);

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
    return () => {
      supabase.removeChannel(channel);
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
    if (ingest.kind !== "success" || platforms.length === 0) return;
    setGen({ kind: "loading", stage: "analyzing" });
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingestion_job_id: ingest.jobId, platforms }),
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
  const isUrl =
    input.trim().startsWith("http://") || input.trim().startsWith("https://");

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="rounded-3xl border border-slate-200/70 bg-white/95 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-500">
          Content studio
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
          New Post
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Paste a URL or share an idea. SocialOS will extract context and draft platform-ready posts.
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
        <form onSubmit={handleIngest}>
          <div className="flex items-center gap-1.5 px-5 pb-2 pt-5">
            {isUrl ? (
              <Link2 className="h-3.5 w-3.5 text-indigo-500" />
            ) : (
              <Type className="h-3.5 w-3.5 text-slate-400" />
            )}
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              {isUrl ? "URL detected" : "Free text"}
            </span>
          </div>

          <textarea
            className="min-h-[150px] w-full resize-none bg-transparent px-5 py-2 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none"
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

          <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/70 px-5 py-3">
            <span className="text-[11px] text-slate-400">
              ⌘ + Enter to extract
            </span>
            <button
              type="submit"
              disabled={isExtractionLoading || isGenerationLoading || !input.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
            >
              {isExtractionLoading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Extracting…
                </>
              ) : (
                "Extract"
              )}
            </button>
          </div>
        </form>
      </div>

      {ingest.kind === "error" && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {ingest.message}
        </p>
      )}

      {extractionDone && ingest.kind === "success" && (
        <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Extracted Content
            </p>
            {ingest.title && (
              <p className="mb-1.5 text-sm font-bold text-slate-900">
                {ingest.title}
              </p>
            )}
            {ingest.text && (
              <div className="text-sm leading-relaxed text-slate-600">
                <p>
                  {showMore ? ingest.text : ingest.text.slice(0, 400)}
                  {ingest.text.length > 400 && !showMore && "…"}
                </p>
                {ingest.text.length > 400 && (
                  <button
                    className="mt-1.5 text-xs font-medium text-indigo-600"
                    onClick={() => setShowMore((v) => !v)}
                  >
                    {showMore ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            )}
            {ingest.media.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
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
                      className="h-16 w-16 rounded-xl border border-slate-200 object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>

          {(gen.kind === "idle" || gen.kind === "error") && (
            <div className="space-y-3 px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Generate for
              </p>
              <div className="flex gap-2">
                {(["linkedin", "x"] as const).map((p) => {
                  const active = platforms.includes(p);
                  const styles =
                      p === "linkedin"
                        ? active
                          ? "bg-[#0077b5] text-white border-[#0077b5]"
                          : "border-slate-200 text-slate-500 hover:border-[#0077b5] hover:text-[#0077b5]"
                        : active
                          ? "border-black bg-black text-white"
                          : "border-slate-200 text-slate-500 hover:border-black hover:text-black";
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-1.5 text-xs font-semibold transition ${styles}`}
                    >
                      {p === "linkedin" ? "LinkedIn" : "X / Twitter"}
                    </button>
                  );
                })}
              </div>
              {gen.kind === "error" && (
                <p className="text-sm text-red-600">{gen.message}</p>
              )}
              <button
                onClick={handleGenerate}
                disabled={platforms.length === 0}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_28px_-16px_rgba(79,70,229,0.9)] transition hover:opacity-95 disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate post
              </button>
            </div>
          )}

          {gen.kind === "loading" && (
            <div className="flex items-center gap-3 px-5 py-4">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
              <span className="text-sm font-medium text-slate-600">
                {STAGE_LABELS[gen.stage] ?? "Generating…"}
              </span>
            </div>
          )}
        </div>
      )}

      {gen.kind === "success" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Generated Drafts
            </p>
            <button
              onClick={() => setGen({ kind: "idle" })}
              className="text-xs font-medium text-indigo-600 hover:underline"
            >
              Regenerate
            </button>
          </div>
          {gen.variants.map((v) => (
            <VariantCard key={v.id} variant={v} jobId={ingest.kind === "success" ? ingest.jobId : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
