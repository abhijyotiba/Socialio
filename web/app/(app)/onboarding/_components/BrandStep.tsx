"use client";

import { useState } from "react";
import { Sparkles, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { VoiceSamplesPanel } from "@/components/voice/VoiceSamplesPanel";

const DEFAULT_PROMPT =
  "You are a professional content writer helping create engaging social media posts. " +
  "Write in a clear, authentic voice that resonates with the target audience. " +
  "Keep posts concise, add relevant context, and end with a call to action when appropriate.";

interface BrandStepProps {
  onComplete: () => void;
}

type Path = "choose" | "voice" | "manual";

export function BrandStep({ onComplete }: BrandStepProps) {
  const [path, setPath] = useState<Path>("choose");
  const [brandName, setBrandName] = useState("");
  const [industry, setIndustry] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [toneInput, setToneInput] = useState("");
  const [toneTags, setToneTags] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function addToneTag() {
    const tag = toneInput.trim().toLowerCase();
    if (tag && !toneTags.includes(tag)) {
      setToneTags((prev) => [...prev, tag]);
    }
    setToneInput("");
  }

  function removeToneTag(tag: string) {
    setToneTags((prev) => prev.filter((t) => t !== tag));
  }

  /**
   * Save the brand row. Used by both paths once basic brand details are filled.
   * The voice path passes its own system prompt (the one rendered by the worker);
   * the manual path passes whatever the user typed.
   */
  async function saveBrand(promptToSave: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/brand/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_name: brandName,
          industry: industry || undefined,
          website_url: websiteUrl || undefined,
          tone_tags: toneTags,
          system_prompt: promptToSave,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Something went wrong. Please try again.");
        return false;
      }
      return true;
    } finally {
      setLoading(false);
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (await saveBrand(systemPrompt)) onComplete();
  }

  // ─── Brand details (shared between both paths) ──────────────────────────
  const brandDetailsValid = brandName.trim().length > 0;

  const brandDetailsForm = (
    <div className="space-y-5">
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="space-y-2">
        <Label htmlFor="brand_name">Brand name *</Label>
        <Input
          id="brand_name"
          placeholder="Acme Corp"
          required
          value={brandName}
          onChange={(e) => setBrandName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="industry">Industry</Label>
        <Input
          id="industry"
          placeholder="SaaS, e-commerce, consulting…"
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="website_url">Website URL</Label>
        <Input
          id="website_url"
          type="url"
          placeholder="https://example.com"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Tone tags</Label>
        <div className="flex gap-2">
          <Input
            placeholder="professional, witty, bold…"
            value={toneInput}
            onChange={(e) => setToneInput(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addToneTag();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addToneTag}>
            Add
          </Button>
        </div>
        {toneTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {toneTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-surface-2 text-muted-foreground"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeToneTag(tag)}
                  className="text-faint-foreground hover:text-foreground"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // ─── Path: choose ───────────────────────────────────────────────────────
  if (path === "choose") {
    return (
      <div className="space-y-5">
        {brandDetailsForm}

        <div className="space-y-2 pt-2">
          <p className="text-sm font-medium">How should we learn your voice?</p>
          <div className="grid gap-2">
            <button
              type="button"
              disabled={!brandDetailsValid}
              onClick={() => setPath("voice")}
              className="group flex items-start gap-3 rounded-xl border-2 border-accent/30 bg-accent/[0.06] p-4 text-left transition hover:border-accent/60 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <div>
                <p className="text-sm font-bold text-foreground">
                  Paste 3–15 of my recent posts{" "}
                  <span className="ml-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Recommended
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  We&apos;ll learn your voice from how you actually write — not
                  a generic template.
                </p>
              </div>
            </button>

            <button
              type="button"
              disabled={!brandDetailsValid}
              onClick={() => setPath("manual")}
              className="group flex items-start gap-3 rounded-xl border-2 border-border bg-surface p-4 text-left transition hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Pencil className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-bold text-foreground">
                  I&apos;ll write the system prompt myself
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Skip voice learning and use a default prompt you can edit.
                </p>
              </div>
            </button>
          </div>
          {!brandDetailsValid && (
            <p className="text-xs text-muted-foreground">
              Enter a brand name to continue.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ─── Path: voice ────────────────────────────────────────────────────────
  if (path === "voice") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
          Brand: <span className="font-semibold">{brandName}</span>
          {toneTags.length > 0 && <> · {toneTags.join(", ")}</>}
          <button
            type="button"
            onClick={() => setPath("choose")}
            className="ml-2 font-semibold text-accent hover:underline"
          >
            Edit
          </button>
        </div>

        <VoiceSamplesPanel
          ctaLabel="Analyze voice"
          successLabel="Use this voice & continue"
          brandDetails={{
            brand_name: brandName,
            industry: industry || undefined,
            website_url: websiteUrl || undefined,
            tone_tags: toneTags,
          }}
          onSuccess={() => {
            // The voice-profile route already wrote brand_configs +
            // prompt_versions in one round trip. Nothing else to save.
            onComplete();
          }}
        />

        <button
          type="button"
          onClick={() => setPath("choose")}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          ← Back
        </button>
      </div>
    );
  }

  // ─── Path: manual ───────────────────────────────────────────────────────
  return (
    <form onSubmit={handleManualSubmit} className="space-y-5">
      <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
        Brand: <span className="font-semibold">{brandName}</span>
        <button
          type="button"
          onClick={() => setPath("choose")}
          className="ml-2 font-semibold text-accent hover:underline"
        >
          Edit
        </button>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="space-y-2">
        <Label htmlFor="system_prompt">Brand system prompt *</Label>
        <p className="text-xs text-muted-foreground">
          The AI instruction your posts are generated from. You can refine it
          anytime in Settings.
        </p>
        <Textarea
          id="system_prompt"
          rows={7}
          required
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={loading}>
          {loading ? "Saving…" : "Save brand & continue"}
        </Button>
      </div>
    </form>
  );
}
