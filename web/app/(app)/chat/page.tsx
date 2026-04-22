"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

interface MediaItem {
  cloudinary_url: string;
  cloudinary_id: string;
  resource_type: string;
  format: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
}

interface IngestResult {
  job_id: string;
  extracted_title: string;
  extracted_text: string;
  media: MediaItem[];
}

type PageState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; result: IngestResult }
  | { kind: "error"; message: string };

const PREVIEW_CHAR_LIMIT = 400;

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [state, setState] = useState<PageState>({ kind: "idle" });
  const [expanded, setExpanded] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = input.trim();
    if (!value) return;

    setState({ kind: "loading" });
    setExpanded(false);

    const isUrl =
      value.startsWith("http://") || value.startsWith("https://");

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isUrl
            ? { source_type: "url", source_url: value }
            : { source_type: "text", source_text: value }
        ),
      });

      const body = await res.json();

      if (!res.ok) {
        setState({
          kind: "error",
          message:
            body.error ??
            `Something went wrong (${res.status}). Please try again.`,
        });
        return;
      }

      setState({ kind: "success", result: body as IngestResult });
    } catch {
      setState({
        kind: "error",
        message: "Network error. Please check your connection and try again.",
      });
    }
  }

  const isLoading = state.kind === "loading";

  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col">
      {/* Empty state / hero */}
      {state.kind === "idle" && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-20">
          <div className="w-full max-w-2xl text-center space-y-3 mb-10">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              New post
            </h1>
            <p className="text-zinc-500 dark:text-zinc-400 text-base">
              Paste a URL or describe what you want to post about.
            </p>
          </div>
          <InputForm
            input={input}
            setInput={setInput}
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
        </div>
      )}

      {/* Loading state */}
      {state.kind === "loading" && (
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-20 gap-8">
          <div className="w-full max-w-2xl">
            <div className="flex flex-col items-center gap-5">
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-2 border-zinc-200 dark:border-zinc-800" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-zinc-900 dark:border-t-zinc-50 animate-spin" />
              </div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 animate-pulse">
                Extracting content…
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {state.kind === "error" && (
        <div className="flex-1 flex flex-col items-center justify-start px-4 py-12 gap-8">
          <div className="w-full max-w-2xl space-y-6">
            <Card className="border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30">
              <CardContent className="pt-5 pb-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-red-500 dark:text-red-400 text-lg leading-none">
                    ⚠
                  </span>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-red-800 dark:text-red-200">
                      Extraction failed
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-300">
                      {state.message}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <InputForm
              input={input}
              setInput={setInput}
              onSubmit={handleSubmit}
              isLoading={isLoading}
            />
          </div>
        </div>
      )}

      {/* Success state */}
      {state.kind === "success" && (
        <div className="flex-1 flex flex-col items-center px-4 py-12 gap-8">
          <div className="w-full max-w-2xl space-y-6">
            {/* Result card */}
            <Card className="border-zinc-200 dark:border-zinc-800">
              <CardContent className="pt-6 pb-6 space-y-5">
                {/* Title */}
                {state.result.extracted_title && (
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 leading-snug">
                    {state.result.extracted_title}
                  </h2>
                )}

                {/* Divider */}
                {state.result.extracted_title &&
                  state.result.extracted_text && (
                    <hr className="border-zinc-100 dark:border-zinc-800" />
                  )}

                {/* Text preview */}
                {state.result.extracted_text && (
                  <div className="space-y-2">
                    <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-line">
                      {expanded
                        ? state.result.extracted_text
                        : state.result.extracted_text.slice(
                            0,
                            PREVIEW_CHAR_LIMIT
                          )}
                      {!expanded &&
                        state.result.extracted_text.length >
                          PREVIEW_CHAR_LIMIT && (
                          <span className="text-zinc-400 dark:text-zinc-500">
                            …
                          </span>
                        )}
                    </p>
                    {state.result.extracted_text.length > PREVIEW_CHAR_LIMIT && (
                      <button
                        onClick={() => setExpanded((p) => !p)}
                        className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                      >
                        {expanded ? "Show less" : "Show more"}
                      </button>
                    )}
                  </div>
                )}

                {/* Media thumbnails */}
                {state.result.media.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {state.result.media.map((m) => (
                      <a
                        key={m.cloudinary_id}
                        href={m.cloudinary_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-square rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 ring-1 ring-zinc-200 dark:ring-zinc-700 hover:ring-zinc-400 dark:hover:ring-zinc-500 transition-all"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={m.cloudinary_url}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Generate button — placeholder for Phase 3 */}
            <div className="flex items-center gap-3">
              <div
                className="relative group"
                title="AI generation coming in Phase 3"
              >
                <Button disabled className="gap-2 opacity-50 cursor-not-allowed">
                  Generate post
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </Button>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 rounded-md bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity">
                  AI generation coming in Phase 3
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => {
                  setState({ kind: "idle" });
                  setInput("");
                }}
              >
                Start over
              </Button>
            </div>

            {/* New input below result */}
            <div>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mb-3">
                Try another URL or text
              </p>
              <InputForm
                input={input}
                setInput={setInput}
                onSubmit={handleSubmit}
                isLoading={isLoading}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InputForm({
  input,
  setInput,
  onSubmit,
  isLoading,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="w-full max-w-2xl space-y-3">
      <Textarea
        rows={3}
        placeholder="Paste a URL or describe what you want to post about…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={isLoading}
        className="resize-none text-sm placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus-visible:ring-zinc-400"
        onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit(e as unknown as React.FormEvent);
          }
        }}
      />
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          ⌘ + Enter to submit
        </p>
        <Button type="submit" disabled={isLoading || !input.trim()}>
          {isLoading ? "Extracting…" : "Extract"}
        </Button>
      </div>
    </form>
  );
}
