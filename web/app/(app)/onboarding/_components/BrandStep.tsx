"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DEFAULT_PROMPT =
  "You are a professional content writer helping create engaging social media posts. " +
  "Write in a clear, authentic voice that resonates with the target audience. " +
  "Keep posts concise, add relevant context, and end with a call to action when appropriate.";

interface BrandStepProps {
  onComplete: () => void;
}

export function BrandStep({ onComplete }: BrandStepProps) {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/brand/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand_name: brandName,
        industry: industry || undefined,
        website_url: websiteUrl || undefined,
        tone_tags: toneTags,
        system_prompt: systemPrompt,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    onComplete();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
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
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeToneTag(tag)}
                  className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="system_prompt">Brand system prompt *</Label>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          This is the AI instruction your posts are generated from. You can
          refine it anytime in Settings.
        </p>
        <Textarea
          id="system_prompt"
          rows={5}
          required
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Saving…" : "Save brand & continue"}
      </Button>
    </form>
  );
}
