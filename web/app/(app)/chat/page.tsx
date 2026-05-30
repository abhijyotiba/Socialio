"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TypingIndicator } from "./_components/TypingIndicator";
import { UserBubble } from "./_components/UserBubble";
import { AiMessage } from "./_components/AiMessage";
import { ExtractionCard } from "./_components/ExtractionCard";
import { ChatInput } from "./_components/ChatInput";
import { parseInput } from "@/lib/chat/parse-input";
import { pollIngestion, type IngestionJob } from "@/lib/chat/poll-ingestion";
import type { Database } from "@/lib/db/types";

type PersonaRow = Database["public"]["Tables"]["personas"]["Row"];
type Media = { cloudinary_url: string; cloudinary_id: string };

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
      userAngle?: string;
      generationError?: string;
      generated?: boolean;
      atomizeState?: "idle" | "running" | "done";
      atomizeResult?: string;
    }
  | { id: string; type: "ai-error"; message: string };

let _uid = 0;
function uid() {
  return `msg-${++_uid}`;
}

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [platforms, setPlatforms] = useState<("linkedin" | "x")[]>([]);
  const [connectedPlatforms, setConnectedPlatforms] = useState<("linkedin" | "x")[]>([]);
  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
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

  function resolvePersonaIds(): string[] {
    if (selectedPersonaIds.length > 0) return selectedPersonaIds;
    return personas[0] ? [personas[0].id] : [];
  }

  async function callCampaigns(
    jobId: string,
    personaIds: string[],
    userAngle: string | null
  ): Promise<{ ok: boolean; data: { campaign_id?: string; error?: string } }> {
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ingestion_job_id: jobId,
        persona_ids: personaIds,
        platforms,
        ...(userAngle ? { user_angle: userAngle } : {}),
      }),
    });
    return { ok: res.ok, data: await res.json() };
  }

  async function handleSubmit() {
    const text = input.trim();
    if (!text || isExtracting || isGenerating) return;
    const { url } = parseInput(text);
    setInput("");

    addMessage({ id: uid(), type: "user", text, isUrl: Boolean(url) });

    if (!url) {
      await handlePromptOnly(text);
      return;
    }

    const { angle } = parseInput(text);
    setIsExtracting(true);
    const typingId = uid();
    addMessage({ id: typingId, type: "ai-typing", label: "Extracting content" });

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: "url", source_url: url }),
      });
      const data = await res.json();
      if (!res.ok) {
        replaceMessage(typingId, { id: typingId, type: "ai-error", message: data.error ?? "Extraction failed." });
        return;
      }

      const jobId = data.job_id;
      const INGEST_STAGE_LABELS: Record<string, string> = {
        pending: "Starting ingestion...",
        scraping: "Scraping URL...",
        uploading_media: "Uploading media assets...",
      };

      // Poll the job until it reaches a terminal stage. The web route returns
      // the job flat ({ ...job, media }), so the parsed body IS the job row.
      // Polling avoids depending on Supabase realtime (not enabled for
      // ingestion_jobs) and handles slow jobs that finish after page load.
      const finalJob = await pollIngestion(jobId, {
        fetchJob: async () => {
          const res = await fetch(`/api/ingest/${jobId}`).catch(() => null);
          if (!res?.ok) return null;
          return (await res.json().catch(() => null)) as IngestionJob | null;
        },
        onStage: (stage) => {
          replaceMessage(typingId, {
            id: typingId,
            type: "ai-typing",
            label: INGEST_STAGE_LABELS[stage] ?? "Extracting content...",
          });
        },
      });

      if (finalJob.stage === "failed") {
        replaceMessage(typingId, { id: typingId, type: "ai-error", message: finalJob.error ?? "Extraction failed." });
        return;
      }

      replaceMessage(typingId, {
        id: typingId,
        type: "ai-extracted",
        jobId,
        title: finalJob.extracted_title || "",
        text: finalJob.extracted_text || "",
        media: finalJob.media || [],
        userAngle: angle || undefined,
      });
    } catch (err) {
      replaceMessage(typingId, {
        id: typingId,
        type: "ai-error",
        message: err instanceof Error ? err.message : "Network error. Please try again.",
      });
    } finally {
      setIsExtracting(false);
    }
  }

  async function handlePromptOnly(prompt: string) {
    if (platforms.length === 0 || isGenerating) return;
    const personaIds = resolvePersonaIds();
    if (personaIds.length === 0) return;
    setIsGenerating(true);

    const generatingId = uid();
    addMessage({ id: generatingId, type: "ai-typing", label: "Generating posts…" });

    try {
      const ingestRes = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_type: "text", source_text: prompt }),
      });
      const ingestData = await ingestRes.json();
      if (!ingestRes.ok) {
        replaceMessage(generatingId, { id: generatingId, type: "ai-error", message: ingestData.error ?? "Couldn't start generation." });
        return;
      }

      const { ok, data } = await callCampaigns(ingestData.job_id, personaIds, prompt);
      if (!ok || !data.campaign_id) {
        replaceMessage(generatingId, { id: generatingId, type: "ai-error", message: data.error ?? "Generation failed." });
        return;
      }
      router.push(`/campaigns/${data.campaign_id}`);
    } catch {
      replaceMessage(generatingId, { id: generatingId, type: "ai-error", message: "Network error. Please try again." });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerate(jobId: string, userAngle?: string) {
    if (platforms.length === 0 || isGenerating) return;
    const personaIds = resolvePersonaIds();
    if (personaIds.length === 0) return;
    setIsGenerating(true);

    const generatingId = uid();
    addMessage({ id: generatingId, type: "ai-typing", label: "Generating posts…" });

    try {
      const { ok, data } = await callCampaigns(jobId, personaIds, userAngle ?? null);
      if (!ok || !data.campaign_id) {
        // Show error on the extraction card, remove the generating indicator
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
      // Mark extraction card as done, then navigate
      setMessages((prev) =>
        prev
          .filter((m) => m.id !== generatingId)
          .map((m) =>
            m.type === "ai-extracted" && m.jobId === jobId ? { ...m, generated: true } : m
          )
      );
      router.push(`/campaigns/${data.campaign_id}`);
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

  async function handleAtomize(jobId: string) {
    if (platforms.length === 0) return;
    const personaIds = resolvePersonaIds();
    if (personaIds.length === 0) return;

    const setState = (
      patch: Partial<{ atomizeState: "idle" | "running" | "done"; atomizeResult?: string; generationError?: string }>
    ) =>
      setMessages((prev) =>
        prev.map((m) =>
          m.type === "ai-extracted" && m.jobId === jobId ? { ...m, ...patch } : m
        )
      );

    setState({ atomizeState: "running", generationError: undefined });
    try {
      const res = await fetch("/api/content-engine/atomize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingestion_job_id: jobId,
          persona_id: personaIds[0],
          platforms,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ atomizeState: "idle", generationError: data.error ?? "Atomize failed." });
        return;
      }
      const ideas = data.ideas_extracted ?? 0;
      const cells = data.cells_materialized ?? 0;
      setState({
        atomizeState: "done",
        atomizeResult: `Extracted ${ideas} idea${ideas === 1 ? "" : "s"} → ${cells} post${cells === 1 ? "" : "s"} queued. They'll roll out at your cadence.`,
      });
    } catch {
      setState({ atomizeState: "idle", generationError: "Network error. Please try again." });
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
                    onGenerate={() => handleGenerate(msg.jobId, msg.userAngle)}
                    onAtomize={() => handleAtomize(msg.jobId)}
                    atomizeState={msg.atomizeState}
                    atomizeResult={msg.atomizeResult}
                    userAngle={msg.userAngle}
                    generationError={msg.generationError}
                    generated={msg.generated}
                    personas={personas}
                    selectedPersonaIds={selectedPersonaIds}
                    onTogglePersona={togglePersona}
                  />
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
