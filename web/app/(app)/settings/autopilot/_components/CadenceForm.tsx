"use client";

import { useState } from "react";
import { Loader2, Zap, ChevronDown } from "lucide-react";

interface Cadence {
  platform: "linkedin" | "x";
  posts_per_week: number;
  autopilot_enabled: boolean;
  active: boolean;
  low_reservoir_threshold: number;
}

const PER_WEEK_OPTIONS = [1, 2, 3, 5, 7, 10, 14];

export function CadenceForm({
  platform,
  label,
  personaId,
  initial,
}: {
  platform: "linkedin" | "x";
  label: string;
  personaId: string;
  initial: Cadence | null;
}) {
  const [postsPerWeek, setPostsPerWeek] = useState(initial?.posts_per_week ?? 3);
  const [autopilot, setAutopilot] = useState(initial?.autopilot_enabled ?? false);
  const [active, setActive] = useState(initial?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const isLinkedIn = platform === "linkedin";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/content-engine/cadence", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          persona_id: personaId,
          platform,
          posts_per_week: postsPerWeek,
          autopilot_enabled: autopilot,
          active,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to save");
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm"
    >
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm ${
            isLinkedIn ? "bg-[#0077b5]" : "bg-slate-900"
          }`}
        >
          {isLinkedIn ? (
            <svg className="h-4.5 w-4.5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
          ) : (
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.73-8.835L1.254 2.25H8.08l4.258 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
            </svg>
          )}
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-900">{label}</h2>
          <p className="text-[11px] text-slate-400">How often the engine posts here</p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Posts per week */}
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-semibold text-slate-700">Posts per week</label>
          <div className="relative">
            <select
              value={postsPerWeek}
              onChange={(e) => setPostsPerWeek(Number(e.target.value))}
              className="h-9 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 text-sm font-semibold text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            >
              {PER_WEEK_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
          </div>
        </div>

        {/* Autopilot toggle */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
          <div>
            <p className="text-xs font-bold text-slate-800">Full autopilot</p>
            <p className="text-[11px] text-slate-400">
              {autopilot
                ? "Posts publish automatically on schedule."
                : "Posts wait for your approval in the review queue."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={autopilot}
            onClick={() => setAutopilot((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              autopilot ? "bg-indigo-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                autopilot ? "translate-x-[1.375rem]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Active toggle */}
        <div className="flex items-center justify-between gap-3">
          <label className="text-xs font-semibold text-slate-700">Engine active</label>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            onClick={() => setActive((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              active ? "bg-indigo-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                active ? "translate-x-[1.375rem]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
        {saved && <p className="text-xs text-emerald-600">Saved.</p>}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          {saving ? "Saving…" : "Save cadence"}
        </button>
      </div>
    </form>
  );
}
