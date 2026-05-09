"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const AVATAR_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6"];

export default function NewPersonaPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, avatar_color: avatarColor }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create persona.");
        return;
      }
      router.push(`/settings/personas/${data.persona.id}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md space-y-6 page-enter">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">New Persona</h1>
        <p className="mt-1 text-xs text-slate-400">Create a persona with its own brand voice and social accounts.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Name */}
        <div className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm space-y-3">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600" htmlFor="name">
              Name <span className="text-red-400">*</span>
            </label>
            <input
              id="name"
              required
              maxLength={50}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Company Brand, CEO, Head of Engineering"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>

          {/* Avatar color */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-600">Avatar Color</label>
            <div className="flex gap-2">
              {AVATAR_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setAvatarColor(color)}
                  className={`h-8 w-8 rounded-full border-2 transition ${
                    avatarColor === color ? "border-slate-900 scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          {name && (
            <div className="flex items-center gap-2.5 pt-1">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ backgroundColor: avatarColor }}
              >
                {name.charAt(0).toUpperCase()}
              </div>
              <p className="text-sm font-medium text-slate-700">{name}</p>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="h-10 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="h-10 flex-1 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create Persona"}
          </button>
        </div>
      </form>
    </div>
  );
}
