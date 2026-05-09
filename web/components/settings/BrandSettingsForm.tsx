"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCheck, AlertCircle, X, Palette, Sparkles } from "lucide-react";
import { VoiceSamplesPanel } from "@/components/voice/VoiceSamplesPanel";

interface BrandFormData {
  brand_name: string;
  industry: string;
  website_url: string;
  tone_tags: string[];
  system_prompt: string;
}

function SectionHeader({ label, description }: { label: string; description?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-bold text-slate-800">{label}</h2>
      {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
    </div>
  );
}

type Props = { personaId: string };

export function BrandSettingsForm({ personaId }: Props) {
  const [form, setForm] = useState<BrandFormData>({
    brand_name: "",
    industry: "",
    website_url: "",
    tone_tags: [],
    system_prompt: "",
  });
  const [toneInput, setToneInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [voiceUpdatedAt, setVoiceUpdatedAt] = useState<string | null>(null);
  const [hasVoiceProfile, setHasVoiceProfile] = useState(false);
  const [showVoicePanel, setShowVoicePanel] = useState(false);

  useEffect(() => {
    fetch("/api/brand/config")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) return;
        setForm({
          brand_name: data.brand_name ?? "",
          industry: data.industry ?? "",
          website_url: data.website_url ?? "",
          tone_tags: data.tone_tags ?? [],
          system_prompt: data.custom_system_prompt ?? "",
        });
        setVoiceUpdatedAt(data.voice_profile_updated_at ?? null);
        setHasVoiceProfile(Boolean(data.voice_profile));
      })
      .catch(() => setFetchError("Failed to load brand settings."))
      .finally(() => setFetching(false));
  }, [personaId]);

  function addToneTag() {
    const tag = toneInput.trim().toLowerCase();
    if (tag && !form.tone_tags.includes(tag)) {
      setForm((prev) => ({ ...prev, tone_tags: [...prev.tone_tags, tag] }));
    }
    setToneInput("");
  }

  function removeToneTag(tag: string) {
    setForm((prev) => ({ ...prev, tone_tags: prev.tone_tags.filter((t) => t !== tag) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    setLoading(true);
    try {
      const res = await fetch("/api/brand/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_name: form.brand_name,
          industry: form.industry || undefined,
          website_url: form.website_url || undefined,
          tone_tags: form.tone_tags,
          system_prompt: form.system_prompt,
          persona_id: personaId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error ?? "Save failed. Please try again.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setLoading(false);
    }
  }

  if (fetching) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-12 w-64 rounded-xl" />
        <div className="skeleton h-40 rounded-2xl" />
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-52 rounded-2xl" />
        <div className="skeleton h-48 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
          <Palette className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">Brand Settings</h1>
          <p className="text-xs text-slate-400">
            Changes to the system prompt create a new version — old posts keep their original.
          </p>
        </div>
      </div>

      {fetchError && (
        <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          <p className="text-sm text-red-600">{fetchError}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Brand profile */}
        <div className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <SectionHeader label="Brand Profile" description="Basic info used to tailor AI-generated content." />
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-600" htmlFor="brand_name">
                  Brand Name <span className="text-red-400">*</span>
                </label>
                <input
                  id="brand_name"
                  required
                  value={form.brand_name}
                  onChange={(e) => setForm((p) => ({ ...p, brand_name: e.target.value }))}
                  placeholder="Acme Inc."
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-600" htmlFor="industry">
                  Industry
                </label>
                <input
                  id="industry"
                  value={form.industry}
                  onChange={(e) => setForm((p) => ({ ...p, industry: e.target.value }))}
                  placeholder="SaaS, E-commerce, Finance…"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-600" htmlFor="website_url">
                Website URL
              </label>
              <input
                id="website_url"
                type="url"
                value={form.website_url}
                onChange={(e) => setForm((p) => ({ ...p, website_url: e.target.value }))}
                placeholder="https://yourwebsite.com"
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>
        </div>

        {/* Tone tags */}
        <div className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <SectionHeader label="Tone Tags" description="Keywords that shape the voice of generated content." />
          <div className="flex gap-2">
            <input
              placeholder="e.g. professional, witty, concise…"
              value={toneInput}
              onChange={(e) => setToneInput(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addToneTag();
                }
              }}
              className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="button"
              onClick={addToneTag}
              className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
            >
              Add
            </button>
          </div>
          {form.tone_tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {form.tone_tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeToneTag(tag)}
                    className="text-indigo-400 transition hover:text-indigo-700"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {form.tone_tags.length === 0 && (
            <p className="mt-2 text-xs text-slate-400">No tags yet. Type a tag and press Enter or comma.</p>
          )}
        </div>

        {/* Voice profile */}
        <div className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                Voice Profile
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {hasVoiceProfile
                  ? "Your generated prompt below was rendered from posts you pasted. Refresh to teach SocialOS your latest writing style."
                  : "Paste a few of your recent posts and we'll learn your voice automatically."}
              </p>
              {voiceUpdatedAt && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Last analyzed{" "}
                  {new Date(voiceUpdatedAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}
            </div>
            {!showVoicePanel && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setShowVoicePanel(true);
                }}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-xs font-bold text-indigo-700 transition hover:border-indigo-400"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {hasVoiceProfile ? "Refresh voice" : "Learn my voice"}
              </button>
            )}
          </div>

          {showVoicePanel && (
            <div className="space-y-3">
              <VoiceSamplesPanel
                ctaLabel={hasVoiceProfile ? "Re-analyze voice" : "Analyze voice"}
                successLabel="Done"
                onSuccess={() => {
                  setShowVoicePanel(false);
                  fetch("/api/brand/config")
                    .then((r) => r.json())
                    .then((data) => {
                      if (data.error) return;
                      setForm((p) => ({
                        ...p,
                        system_prompt: data.custom_system_prompt ?? "",
                      }));
                      setVoiceUpdatedAt(data.voice_profile_updated_at ?? null);
                      setHasVoiceProfile(Boolean(data.voice_profile));
                    });
                }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setShowVoicePanel(false);
                }}
                className="text-[11px] font-medium text-slate-400 hover:text-slate-700"
              >
                ← Cancel
              </button>
            </div>
          )}
        </div>

        {/* System prompt */}
        <div className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <SectionHeader
            label="System Prompt"
            description="Instructions that guide every AI-generated post. Saving creates a new version."
          />
          <textarea
            id="system_prompt"
            rows={7}
            required
            value={form.system_prompt}
            onChange={(e) => setForm((p) => ({ ...p, system_prompt: e.target.value }))}
            placeholder="You are a content writer for {brand_name}. Write in a professional but approachable tone…"
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <p className="mt-1.5 text-[11px] text-slate-400">
            {form.system_prompt.length.toLocaleString()} characters
          </p>
        </div>

        {/* Feedback */}
        {saveError && (
          <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            <p className="text-sm text-red-600">{saveError}</p>
          </div>
        )}
        {saved && (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 animate-message-in">
            <CheckCheck className="h-4 w-4 shrink-0 text-emerald-500" />
            <p className="text-sm font-medium text-emerald-700">Brand settings saved successfully.</p>
          </div>
        )}

        {/* Save button */}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
