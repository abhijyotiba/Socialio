"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit2, CheckCheck, Loader2 } from "lucide-react";

export function DisplayNameEditor({ initial }: { initial: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!displayName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: displayName.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Save failed");
        return;
      }
      setSuccess(true);
      setEditing(false);
      setTimeout(() => setSuccess(false), 3000);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-9 rounded-lg border border-white/30 bg-white/10 px-3 text-sm font-bold text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/40 backdrop-blur-sm"
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/20 px-3 text-xs font-bold text-white backdrop-blur-sm transition hover:bg-white/30 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCheck className="h-3 w-3" />}
            Save
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-xs font-medium text-white/60 transition hover:text-white/90"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <h1 className="font-display text-xl font-bold capitalize text-white">
            {displayName}
          </h1>
          <button
            onClick={() => setEditing(true)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
      {success && (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-300">
          <CheckCheck className="h-3 w-3" /> Name updated
        </p>
      )}
    </>
  );
}
