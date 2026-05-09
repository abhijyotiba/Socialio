"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { VariantCard } from "./_components/VariantCard";
import { TypingIndicator } from "./_components/TypingIndicator";
import { UserBubble } from "./_components/UserBubble";
import { AiMessage } from "./_components/AiMessage";
import { ExtractionCard } from "./_components/ExtractionCard";
import { ChatInput } from "./_components/ChatInput";
import { CampaignBatchCard } from "./_components/CampaignBatchCard";
import type { Database } from "@/lib/db/types";

type PersonaRow = Database["public"]["Tables"]["personas"]["Row"];
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
  | { id: string; type: "ai-campaign"; campaignId: string }
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
  const [platforms, setPlatforms] = useState<("linkedin" | "x")[]>([]);
  const [connectedPlatforms, setConnectedPlatforms] = useState<("linkedin" | "x")[]>([]);
  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    fetch("/api/connections")
      .then((r) => r.json())
      .then((data: { connections: { platform: string }[] }) => {
        const connected = (data.connections ?? [])
          .map((c) => c.platform)
          .filter((p): p is "linkedin" | "x" => p === "linkedin" || p === "x");
        setConnectedPlatforms(connected);
        setPlatforms(connected);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then((data: { personas: PersonaRow[] }) => {
        const list = data.personas ?? [];
        setPersonas(list);
        setSelectedPersonaIds(list.map((p) => p.id));
      })
      .catch(() => {});
  }, []);

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

  function togglePersona(id: string) {
    setSelectedPersonaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
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

    const isMultiPersona = selectedPersonaIds.length > 1;

    if (isMultiPersona) {
      const generatingId = uid();
      addMessage({ id: generatingId, type: "ai-typing", label: "Generating for all personas…" });

      try {
        const res = await fetch("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ingestion_job_id: jobId,
            persona_ids: selectedPersonaIds,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setMessages((prev) =>
            prev
              .filter((m) => m.id !== generatingId)
              .map((m) =>
                m.type === "ai-extracted" && m.jobId === jobId
                  ? { ...m, generationError: data.error ?? "Campaign generation failed." }
                  : m
              )
          );
          return;
        }
        setMessages((prev) =>
          prev
            .map((m) =>
              m.id === generatingId
                ? ({ id: generatingId, type: "ai-campaign", campaignId: data.campaign_id } as ChatMessage)
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
      return;
    }

    // Single persona — use the existing POST /api/posts path
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
      <div className="shrink-0 flex items-center justify-between pb-5 border-b border-slate-100/80">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-md shadow-indigo-500/30">
            <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-slate-900 leading-tight">Content Studio</h1>
            <p className="text-xs text-slate-400 leading-tight mt-0.5">Paste a URL or share an idea to generate posts</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center px-4 animate-fade-in">
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-3xl bg-indigo-500/20 blur-2xl scale-150" />
              <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 shadow-xl shadow-indigo-500/40">
                <svg className="h-9 w-9 text-white drop-shadow" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
            <p className="text-xl font-bold tracking-tight text-slate-900">
              What would you like to post about?
            </p>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
              Paste a URL or share an idea — SocialOS drafts platform-ready posts in seconds.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                { label: "Paste a blog URL", icon: "🔗" },
                { label: "Share a product launch idea", icon: "🚀" },
                { label: "Summarise a YouTube video", icon: "▶️" },
              ].map(({ label, icon }) => (
                <button
                  key={label}
                  onClick={() => setInput(label)}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 hover:shadow-md active:scale-[0.97]"
                >
                  <span>{icon}</span>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2 pr-1">
            {messages.map((msg) => {
              if (msg.type === "user") {
                return <UserBubble key={msg.id} text={msg.text} isUrl={msg.isUrl} />;
              }
              if (msg.type === "ai-typing") {
                return <TypingIndicator key={msg.id} label={msg.label} />;
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
                    connectedPlatforms={connectedPlatforms}
                    onTogglePlatform={togglePlatform}
                    onGenerate={() => handleGenerate(msg.jobId)}
                    generationError={msg.generationError}
                    generated={msg.generated}
                    personas={personas}
                    selectedPersonaIds={selectedPersonaIds}
                    onTogglePersona={togglePersona}
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
              if (msg.type === "ai-campaign") {
                return (
                  <div key={msg.id} className="pl-11 animate-message-in">
                    <CampaignBatchCard campaignId={msg.campaignId} />
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
