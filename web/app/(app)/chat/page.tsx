"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { VariantCard } from "./_components/VariantCard";
import { TypingIndicator } from "./_components/TypingIndicator";
import { UserBubble } from "./_components/UserBubble";
import { AiMessage } from "./_components/AiMessage";
import { ExtractionCard } from "./_components/ExtractionCard";
import { ChatInput } from "./_components/ChatInput";

type Media = { cloudinary_url: string; cloudinary_id: string };
type Variant = { id: string; platform: string; body: string };

type ChatMessage =
  | { id: string; type: "user"; text: string; isUrl: boolean }
  | { id: string; type: "ai-typing"; label: string }
  | {
      id: string;
      type: "ai-extracted";
      jobId: string;
      title: string;
      text: string;
      media: Media[];
      generationError?: string;
      generated?: boolean;
    }
  | { id: string; type: "ai-generating"; jobId: string; stage: string }
  | { id: string; type: "ai-variants"; variants: Variant[]; jobId: string }
  | { id: string; type: "ai-error"; message: string };

const STAGE_LABELS: Record<string, string> = {
  analyzing: "Analyzing content…",
  generating: "Writing posts…",
  storing: "Saving drafts…",
  done: "Done!",
};

let _uid = 0;
function uid() {
  return `msg-${++_uid}`;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [platforms, setPlatforms] = useState<("linkedin" | "x")[]>(["linkedin"]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!activeJobId || !isGenerating) return;
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`gen-${activeJobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ingestion_jobs",
          filter: `id=eq.${activeJobId}`,
        },
        (payload) => {
          const stage = (payload.new as { stage: string }).stage;
          setMessages((prev) =>
            prev.map((m) =>
              m.type === "ai-generating" && m.jobId === activeJobId
                ? { ...m, stage }
                : m
            )
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeJobId, isGenerating]);

  function addMessage(msg: ChatMessage) {
    setMessages((prev) => [...prev, msg]);
  }

  function replaceMessage(id: string, msg: ChatMessage) {
    setMessages((prev) => prev.map((m) => (m.id === id ? msg : m)));
  }

  async function handleSubmit() {
    const text = input.trim();
    if (!text || isExtracting || isGenerating) return;
    const isUrl = text.startsWith("http://") || text.startsWith("https://");
    setInput("");
    setIsExtracting(true);

    const userId = uid();
    const typingId = uid();
    addMessage({ id: userId, type: "user", text, isUrl });
    addMessage({ id: typingId, type: "ai-typing", label: "Extracting content" });

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: isUrl ? "url" : "text",
          ...(isUrl ? { source_url: text } : { source_text: text }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        replaceMessage(typingId, {
          id: typingId,
          type: "ai-error",
          message: data.error ?? "Extraction failed.",
        });
        return;
      }
      setActiveJobId(data.job_id);
      replaceMessage(typingId, {
        id: typingId,
        type: "ai-extracted",
        jobId: data.job_id,
        title: data.extracted_title,
        text: data.extracted_text,
        media: data.media,
      });
    } catch {
      replaceMessage(typingId, {
        id: typingId,
        type: "ai-error",
        message: "Network error. Please try again.",
      });
    } finally {
      setIsExtracting(false);
    }
  }

  async function handleGenerate(jobId: string) {
    if (platforms.length === 0 || isGenerating) return;
    setIsGenerating(true);

    const generatingId = uid();
    addMessage({ id: generatingId, type: "ai-generating", jobId, stage: "analyzing" });

    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingestion_job_id: jobId, platforms }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) =>
          prev
            .filter((m) => m.id !== generatingId)
            .map((m) =>
              m.type === "ai-extracted" && m.jobId === jobId
                ? { ...m, generationError: data.error ?? "Generation failed." }
                : m
            )
        );
        return;
      }
      setMessages((prev) =>
        prev
          .map((m) =>
            m.id === generatingId
              ? ({ id: generatingId, type: "ai-variants", variants: data.variants, jobId } as ChatMessage)
              : m.type === "ai-extracted" && m.jobId === jobId
                ? { ...m, generated: true }
                : m
          )
      );
    } catch {
      setMessages((prev) =>
        prev
          .filter((m) => m.id !== generatingId)
          .map((m) =>
            m.type === "ai-extracted" && m.jobId === jobId
              ? { ...m, generationError: "Network error. Please try again." }
              : m
          )
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function togglePlatform(p: "linkedin" | "x") {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  const isBusy = isExtracting || isGenerating;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 shadow-sm shadow-indigo-500/30">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-slate-900 leading-tight">Content Studio</h1>
            <p className="text-[11px] text-slate-400 leading-tight">Paste a URL or share an idea to generate posts</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center px-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-md shadow-indigo-500/30">
              <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <p className="mt-4 text-base font-bold text-slate-800">
              What would you like to post about?
            </p>
            <p className="mt-1 max-w-xs text-sm text-slate-400">
              Paste a URL or share an idea. SocialOS will draft platform-ready posts in seconds.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {[
                "Paste a blog URL",
                "Share a product launch idea",
                "Summarise a YouTube video",
              ].map((hint) => (
                <button
                  key={hint}
                  onClick={() => setInput(hint)}
                  className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-indigo-300 hover:text-indigo-600"
                >
                  {hint}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2 pr-1">
            {messages.map((msg) => {
              if (msg.type === "user") {
                return (
                  <UserBubble key={msg.id} text={msg.text} isUrl={msg.isUrl} />
                );
              }
              if (msg.type === "ai-typing") {
                return (
                  <TypingIndicator key={msg.id} label={msg.label} />
                );
              }
              if (msg.type === "ai-error") {
                return (
                  <AiMessage key={msg.id}>
                    <p className="text-sm text-red-600">{msg.message}</p>
                  </AiMessage>
                );
              }
              if (msg.type === "ai-extracted") {
                return (
                  <ExtractionCard
                    key={msg.id}
                    title={msg.title}
                    text={msg.text}
                    media={msg.media}
                    platforms={platforms}
                    onTogglePlatform={togglePlatform}
                    onGenerate={() => handleGenerate(msg.jobId)}
                    generationError={msg.generationError}
                    generated={msg.generated}
                  />
                );
              }
              if (msg.type === "ai-generating") {
                return (
                  <TypingIndicator
                    key={msg.id}
                    label={STAGE_LABELS[msg.stage] ?? "Generating…"}
                  />
                );
              }
              if (msg.type === "ai-variants") {
                return (
                  <div key={msg.id} className="space-y-3 animate-message-in">
                    <AiMessage>
                      <p className="text-sm font-medium text-slate-700">
                        Here are your drafts — ready to publish or schedule.
                      </p>
                    </AiMessage>
                    {msg.variants.map((v, i) => (
                      <div
                        key={v.id}
                        className="pl-11 animate-message-in"
                        style={{ animationDelay: `${i * 0.08}s` }}
                      >
                        <VariantCard variant={v} jobId={msg.jobId} />
                      </div>
                    ))}
                  </div>
                );
              }
              return null;
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={isBusy}
        isLoading={isExtracting}
      />
    </div>
  );
}
