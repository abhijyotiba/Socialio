"use client";

import { useState } from "react";
import {
  Loader2,
  Sparkles,
  Plus,
  Trash2,
  CheckCheck,
  AlertCircle,
  Eye,
  EyeOff,
} from "lucide-react";

interface VoiceProfile {
  schema_version: number;
  samples_count: number;
  platform_mix?: Record<string, number>;
  length: { avg_words: number; p90_words: number; tends: string };
  structure: {
    uses_line_breaks: boolean;
    uses_bullets: string;
    uses_numbered_lists: boolean;
    paragraph_count_avg: number;
  };
  tone: {
    register: string;
    uses_first_person: boolean;
    personal_anecdotes: string;
    emoji_use: string;
    emoji_typical: string[];
  };
  openers: { patterns: string[]; examples: string[] };
  closers: { patterns: string[]; uses_hashtags: string };
  topics: string[];
  avoid: string[];
}

interface AnalyzeResult {
  profile: VoiceProfile;
  system_prompt: string;
  version_number: number;
}

const MIN_SAMPLES = 3;
const MAX_SAMPLES = 15;
const MIN_CHARS = 20;

interface BrandDetails {
  brand_name: string;
  industry?: string;
  website_url?: string;
  tone_tags?: string[];
}

export function VoiceSamplesPanel({
  onSuccess,
  initialResult,
  ctaLabel = "Analyze voice",
  successLabel = "Use this voice & continue",
  brandDetails,
  personaId,
}: {
  onSuccess?: (result: AnalyzeResult) => void;
  initialResult?: AnalyzeResult | null;
  ctaLabel?: string;
  successLabel?: string;
  /**
   * If provided, forwarded to the voice-profile route so the same call
   * finalizes brand_configs in one round trip. Used during onboarding,
   * where brand_configs may not exist yet.
   */
  brandDetails?: BrandDetails;
  /**
   * Target persona for the voice profile. Omitting it falls back to the
   * workspace default — only safe during onboarding when there's only one
   * persona. From the per-persona settings page, always pass this.
   */
  personaId?: string;
}) {
  const [samples, setSamples] = useState<string[]>(["", "", ""]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(
    initialResult ?? null
  );
  const [showRawProfile, setShowRawProfile] = useState(false);

  const filledCount = samples.filter(
    (s) => s.trim().length >= MIN_CHARS
  ).length;
  const canAnalyze = filledCount >= MIN_SAMPLES && !submitting;

  function updateSample(i: number, value: string) {
    setSamples((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  }

  function addSample() {
    if (samples.length >= MAX_SAMPLES) return;
    setSamples((prev) => [...prev, ""]);
  }

  function removeSample(i: number) {
    if (samples.length <= MIN_SAMPLES) return;
    setSamples((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleAnalyze() {
    setError(null);
    const cleaned = samples
      .map((s) => s.trim())
      .filter((s) => s.length >= MIN_CHARS);
    if (cleaned.length < MIN_SAMPLES) {
      setError(
        `Add at least ${MIN_SAMPLES} samples of ${MIN_CHARS}+ characters each.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/brand/voice-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          samples: cleaned,
          brand_details: brandDetails,
          persona_id: personaId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : "Analysis failed. Try again with different samples.";
        setError(msg);
        return;
      }
      setResult(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4">
        <ProfileSummary
          profile={result.profile}
          version={result.version_number}
        />

        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">
              Generated system prompt
            </h3>
            <button
              type="button"
              onClick={() => setShowRawProfile((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition hover:text-accent"
            >
              {showRawProfile ? (
                <>
                  <EyeOff className="h-3.5 w-3.5" /> Hide raw profile
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" /> Show raw profile
                </>
              )}
            </button>
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-4 text-xs leading-relaxed text-foreground">
            {result.system_prompt}
          </pre>
          {showRawProfile && (
            <pre className="mt-3 max-h-48 overflow-auto rounded-xl border border-border bg-surface p-3 text-[11px] leading-relaxed text-muted-foreground">
              {JSON.stringify(result.profile, null, 2)}
            </pre>
          )}
        </div>

        <div className="flex items-center gap-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
          <CheckCheck className="h-4 w-4 shrink-0 text-success" />
          <p className="text-sm text-success">
            Saved as prompt version {result.version_number}.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setSamples(["", "", ""]);
            }}
            className="h-10 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-muted-foreground transition hover:border-accent/40 hover:text-accent"
          >
            Try different samples
          </button>
          {onSuccess && (
            <button
              type="button"
              onClick={() => onSuccess(result)}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-accent-foreground shadow-sm transition hover:brightness-110"
            >
              {successLabel}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-3">
          <h3 className="text-sm font-bold text-foreground">
            Paste {MIN_SAMPLES}–{MAX_SAMPLES} of your recent posts
          </h3>
          <p className="mt-0.5 text-xs text-faint-foreground">
            Copy real LinkedIn or X posts you&apos;ve written. We&apos;ll learn
            your voice from them — not store the posts themselves.
          </p>
        </div>

        <div className="space-y-3">
          {samples.map((sample, i) => {
            const length = sample.trim().length;
            const valid = length >= MIN_CHARS;
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Sample {i + 1}
                  </span>
                  <div className="flex items-center gap-2 text-[11px] text-faint-foreground">
                    <span className={valid ? "text-success" : ""}>
                      {length} / {MIN_CHARS}+ chars
                    </span>
                    {samples.length > MIN_SAMPLES && (
                      <button
                        type="button"
                        onClick={() => removeSample(i)}
                        className="text-faint-foreground transition hover:text-destructive"
                        aria-label={`Remove sample ${i + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  rows={4}
                  value={sample}
                  onChange={(e) => updateSample(i, e.target.value)}
                  placeholder="Paste a post you wrote — the more characteristic, the better."
                  className="w-full resize-y rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-sm leading-relaxed text-foreground placeholder:text-faint-foreground transition focus:border-accent/50 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-border"
                />
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={addSample}
            disabled={samples.length >= MAX_SAMPLES}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent transition hover:text-accent disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add sample
            <span className="text-faint-foreground">
              ({samples.length}/{MAX_SAMPLES})
            </span>
          </button>
          <span className="text-[11px] text-faint-foreground">
            {filledCount}/{MIN_SAMPLES} valid
          </span>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleAnalyze}
          disabled={!canAnalyze}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-accent-foreground shadow-sm transition hover:brightness-110 disabled:opacity-40"
        >
          {submitting ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" /> {ctaLabel}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function ProfileSummary({
  profile,
  version,
}: {
  profile: VoiceProfile;
  version: number;
}) {
  const sentences: string[] = [];

  // Length
  const lengthMap: Record<string, string> = {
    short: `You write short, punchy posts (around ${profile.length.avg_words} words on average)`,
    medium: `You write medium-length posts (around ${profile.length.avg_words} words on average)`,
    long: `You write longer, in-depth posts (around ${profile.length.avg_words} words on average)`,
  };
  sentences.push(lengthMap[profile.length.tends] ?? lengthMap.medium);

  // Tone
  const registerMap: Record<string, string> = {
    casual: "in a casual, conversational tone",
    "informal-professional": "in an informal-professional tone",
    "formal-professional": "in a formal-professional tone",
    academic: "in an academic, careful tone",
    playful: "in a playful, witty tone",
  };
  sentences.push(registerMap[profile.tone.register] ?? registerMap.casual);

  // Anecdotes / first person
  if (profile.tone.personal_anecdotes === "frequent") {
    sentences.push("often weaving in personal stories");
  } else if (profile.tone.personal_anecdotes === "occasional") {
    sentences.push("with occasional personal anecdotes");
  }

  // Opener pattern (first one only — keep summary tight)
  if (profile.openers.patterns.length > 0) {
    sentences.push(
      `typically opening with a ${profile.openers.patterns[0]}`
    );
  }

  // Hashtag posture
  if (profile.closers.uses_hashtags === "never") {
    sentences.push("and you almost never use hashtags");
  } else if (profile.closers.uses_hashtags === "often") {
    sentences.push("and you regularly close with focused hashtags");
  }

  return (
    <div className="rounded-2xl border border-accent/25 bg-accent/[0.08] p-5">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-bold text-foreground">
          Your voice profile
          <span className="ml-2 text-[11px] font-medium text-accent">
            v{version}
          </span>
        </h3>
      </div>
      <p className="text-sm leading-relaxed text-foreground">
        {sentences.join(", ")}.
      </p>

      {profile.topics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {profile.topics.slice(0, 5).map((topic) => (
            <span
              key={topic}
              className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-accent ring-1 ring-inset ring-accent/30"
            >
              {topic}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
