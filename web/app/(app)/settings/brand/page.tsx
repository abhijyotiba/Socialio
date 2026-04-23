"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface BrandFormData {
  brand_name: string;
  industry: string;
  website_url: string;
  tone_tags: string[];
  system_prompt: string;
}

export default function BrandSettingsPage() {
  const [form, setForm] = useState<BrandFormData>({
    brand_name: "",
    industry: "",
    website_url: "",
    tone_tags: [],
    system_prompt: "",
  });
  const [toneInput, setToneInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
      })
      .catch(() => setFetchError("Failed to load brand settings."));
  }, []);

  function addToneTag() {
    const tag = toneInput.trim().toLowerCase();
    if (tag && !form.tone_tags.includes(tag)) {
      setForm((prev) => ({ ...prev, tone_tags: [...prev.tone_tags, tag] }));
    }
    setToneInput("");
  }

  function removeToneTag(tag: string) {
    setForm((prev) => ({
      ...prev,
      tone_tags: prev.tone_tags.filter((t) => t !== tag),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    setSaved(false);
    setLoading(true);

    const res = await fetch("/api/brand/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand_name: form.brand_name,
        industry: form.industry || undefined,
        website_url: form.website_url || undefined,
        tone_tags: form.tone_tags,
        system_prompt: form.system_prompt,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setSaveError(body.error ?? "Save failed. Please try again.");
      setLoading(false);
      return;
    }

    setSaved(true);
    setLoading(false);
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Brand settings
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Changing the system prompt creates a new version — previous posts keep
          their original prompt.
        </p>
      </div>

      {fetchError && (
        <p className="text-sm text-red-600 dark:text-red-400">{fetchError}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Brand profile</CardTitle>
          <CardDescription>
            Basic info used to tailor AI-generated content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {saveError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {saveError}
              </p>
            )}
            {saved && (
              <p className="text-sm text-green-600 dark:text-green-400">
                Saved successfully.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="brand_name">Brand name *</Label>
              <Input
                id="brand_name"
                required
                value={form.brand_name}
                onChange={(e) =>
                  setForm((p) => ({ ...p, brand_name: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={form.industry}
                onChange={(e) =>
                  setForm((p) => ({ ...p, industry: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="website_url">Website URL</Label>
              <Input
                id="website_url"
                type="url"
                value={form.website_url}
                onChange={(e) =>
                  setForm((p) => ({ ...p, website_url: e.target.value }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Tone tags</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Add a tag…"
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
              {form.tone_tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {form.tone_tags.map((tag) => (
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
              <Label htmlFor="system_prompt">System prompt *</Label>
              <Textarea
                id="system_prompt"
                rows={6}
                required
                value={form.system_prompt}
                onChange={(e) =>
                  setForm((p) => ({ ...p, system_prompt: e.target.value }))
                }
              />
            </div>

            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
