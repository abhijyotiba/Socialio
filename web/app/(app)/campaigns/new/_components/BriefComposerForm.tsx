"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { PersonaSelector } from "@/app/(app)/chat/_components/PersonaSelector";
import { useNowPlusMinutes } from "@/lib/hooks/useNowPlusMinutes";
import { SUPPORTED_PLATFORMS, type Platform } from "@/lib/constants/platforms";
import { buildCampaignPayload } from "@/lib/campaigns/brief";
import type { Database } from "@/lib/db/types";

type PersonaRow = Database["public"]["Tables"]["personas"]["Row"];
type Group = { id: string; name: string; persona_ids: string[] };

const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: "LinkedIn",
  x: "X",
};

// Convert a datetime-local value ("2026-08-01T09:00") to an ISO string.
// Returns "" for empty input so the payload builder omits the key.
function toIso(local: string): string {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function BriefComposerForm({
  personas,
  connectedPlatforms,
  groups,
}: {
  personas: PersonaRow[];
  connectedPlatforms: string[];
  groups: Group[];
}) {
  const router = useRouter();

  // Earliest selectable window time — a couple minutes out so users can't pick
  // a time already in the past by the time the campaign generates.
  const minDateTime = useNowPlusMinutes(5);

  // Platforms available to toggle: SUPPORTED_PLATFORMS ∩ connected.
  const availablePlatforms = SUPPORTED_PLATFORMS.filter((p) =>
    connectedPlatforms.includes(p)
  );

  const [goal, setGoal] = useState("");
  const [coreMessage, setCoreMessage] = useState("");
  const [tone, setTone] = useState("");
  const [cta, setCta] = useState("");
  const [userAngle, setUserAngle] = useState("");
  const [dos, setDos] = useState<string[]>([""]);
  const [donts, setDonts] = useState<string[]>([""]);
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] =
    useState<Platform[]>(availablePlatforms);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function togglePlatform(p: Platform) {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    );
  }

  function togglePersona(id: string) {
    setSelectedPersonaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError("");

    const selectedGroups = groups.filter((g) => selectedGroupIds.includes(g.id));

    const payload = buildCampaignPayload(
      {
        goal,
        coreMessage,
        tone,
        cta,
        userAngle,
        dos,
        donts,
        windowStart: toIso(windowStart),
        windowEnd: toIso(windowEnd),
      },
      {
        selectedPersonaIds,
        selectedGroups,
        allPersonaIds: personas.map((p) => p.id),
      },
      { selected: selectedPlatforms, connected: connectedPlatforms }
    );

    if (payload.persona_ids.length === 0) {
      setError("Add a persona before generating a campaign.");
      return;
    }
    if (!payload.platforms || payload.platforms.length === 0) {
      setError("Connect and select at least one platform.");
      return;
    }

    setSubmitting(true);
    try {
      // The worker requires a completed ingestion job. For a brief-only
      // campaign we first create a text ingestion job from the brief text,
      // then attach its id to the campaign payload.
      const seedText = [goal, coreMessage, userAngle]
        .map((s) => s.trim())
        .filter(Boolean)
        .join("\n\n");
      const ingestRes = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "text",
          source_text: seedText || "Campaign brief",
        }),
      });
      const ingestData = await ingestRes.json().catch(() => ({}));
      if (!ingestRes.ok || !ingestData.job_id) {
        setError(ingestData.error ?? "Couldn't start the campaign.");
        return;
      }

      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingestion_job_id: ingestData.job_id,
          ...payload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.campaign_id) {
        setError(data.error ?? "Failed to create the campaign.");
        return;
      }
      router.push(`/campaigns/${data.campaign_id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Brief */}
      <div className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Brief</h2>

        <Field label="Goal">
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What should this campaign achieve?"
            className={inputClass}
          />
        </Field>

        <Field label="Core message">
          <textarea
            value={coreMessage}
            onChange={(e) => setCoreMessage(e.target.value)}
            placeholder="The one thing every post should land."
            rows={3}
            className={inputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tone">
            <input
              type="text"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder="e.g. confident, playful"
              className={inputClass}
            />
          </Field>
          <Field label="Call to action">
            <input
              type="text"
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              placeholder="e.g. Book a demo"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Angle (optional)">
          <input
            type="text"
            value={userAngle}
            onChange={(e) => setUserAngle(e.target.value)}
            placeholder="A specific spin or point of view."
            className={inputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <ListInput label="Do" items={dos} onChange={setDos} placeholder="Do…" />
          <ListInput
            label="Don't"
            items={donts}
            onChange={setDonts}
            placeholder="Don't…"
          />
        </div>
      </div>

      {/* Platforms */}
      <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Platforms</h2>
        {availablePlatforms.length === 0 ? (
          <p className="text-xs text-slate-400">
            No connected platforms. Connect an account in settings first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {availablePlatforms.map((p) => {
              const selected = selectedPlatforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    selected
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  {PLATFORM_LABEL[p]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Audience */}
      <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Audience</h2>

        {groups.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <p className="w-full text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              Select all in group:
            </p>
            {groups.map((g) => {
              const selected = selectedGroupIds.includes(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggleGroup(g.id)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    selected
                      ? "border-indigo-600 bg-indigo-600 text-white"
                      : "border-slate-200 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  {g.name}
                  <span className="ml-1 opacity-70">
                    ({g.persona_ids.length})
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {personas.length <= 1 ? (
          <p className="text-xs text-slate-400">
            Content will be generated for your persona.
          </p>
        ) : (
          <PersonaSelector
            personas={personas}
            selectedIds={selectedPersonaIds}
            onToggle={togglePersona}
          />
        )}
      </div>

      {/* Scheduling window */}
      <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">
          Scheduling window (optional)
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start">
            <input
              type="datetime-local"
              value={windowStart}
              min={minDateTime}
              onChange={(e) => setWindowStart(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="End">
            <input
              type="datetime-local"
              value={windowEnd}
              min={windowStart || minDateTime}
              onChange={(e) => setWindowEnd(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? "Generating…" : "Generate campaign"}
        </button>
      </div>
    </form>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function ListInput({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  function update(index: number, value: string) {
    onChange(items.map((item, i) => (i === index ? value : item)));
  }
  function add() {
    onChange([...items, ""]);
  }
  function remove(index: number) {
    const next = items.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [""]);
  }

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </span>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={item}
              onChange={(e) => update(i, e.target.value)}
              placeholder={placeholder}
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label={`Remove ${label} item`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 transition hover:text-indigo-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    </div>
  );
}
