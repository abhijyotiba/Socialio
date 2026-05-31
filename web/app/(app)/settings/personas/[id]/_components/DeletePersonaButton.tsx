"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeletePersonaButton({ personaId }: { personaId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!confirm("Delete this persona? This cannot be undone.")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/personas/${personaId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Delete failed.");
        return;
      }
      router.push("/settings/personas");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pt-4 border-t border-border">
      {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
      <button
        onClick={handleDelete}
        disabled={loading}
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 text-xs font-semibold text-destructive transition hover:border-destructive/50 hover:bg-destructive/20 disabled:opacity-50"
      >
        {loading ? "Deleting…" : "Delete Persona"}
      </button>
    </div>
  );
}
