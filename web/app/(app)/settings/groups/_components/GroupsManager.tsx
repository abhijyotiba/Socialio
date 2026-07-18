"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Pencil, Trash2, Check, X } from "lucide-react";

interface Persona {
  id: string;
  name: string;
  avatar_color: string;
}

interface Group {
  id: string;
  name: string;
  persona_ids: string[];
}

export function GroupsManager({
  initialGroups,
  personas,
}: {
  initialGroups: Group[];
  personas: Persona[];
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) {
      setError("Group name is required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/account-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create group");
      }
      setNewName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Create form */}
      <form
        onSubmit={handleCreate}
        className="card-lift rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm"
      >
        <label className="text-xs font-semibold text-slate-700">
          New group
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Founders"
            className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <button
            type="submit"
            disabled={creating}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {creating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            Create
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </form>

      {/* Group list */}
      <div className="space-y-3">
        {initialGroups.map((group) => (
          <GroupCard key={group.id} group={group} personas={personas} />
        ))}

        {initialGroups.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            No account groups yet.
          </p>
        )}
      </div>
    </div>
  );
}

function GroupCard({
  group,
  personas,
}: {
  group: Group;
  personas: Persona[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(group.persona_ids)
  );

  async function handleRename() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Group name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/account-groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to rename");
      }
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete group "${group.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/account-groups/${group.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setBusy(false);
    }
  }

  async function toggleMember(personaId: string) {
    const next = new Set(selected);
    if (next.has(personaId)) next.delete(personaId);
    else next.add(personaId);
    setSelected(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/account-groups/${group.id}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona_ids: Array.from(next) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to update members");
      }
      router.refresh();
    } catch (err) {
      setSelected(new Set(group.persona_ids));
      setError(err instanceof Error ? err.message : "Failed to update members");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        {editing ? (
          <div className="flex flex-1 items-center gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="button"
              onClick={handleRename}
              disabled={busy}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:opacity-50"
              aria-label="Save name"
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setName(group.name);
                setEditing(false);
                setError(null);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200"
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <p className="text-sm font-bold text-slate-900">{group.name}</p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
                aria-label="Rename group"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                aria-label="Delete group"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Persona checkboxes */}
      <div className="mt-4 space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Personas
        </p>
        {personas.length === 0 ? (
          <p className="text-xs text-slate-400">No personas to assign.</p>
        ) : (
          personas.map((persona) => {
            const checked = selected.has(persona.id);
            return (
              <label
                key={persona.id}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 px-3 py-2 transition hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={() => toggleMember(persona.id)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                  style={{ backgroundColor: persona.avatar_color }}
                >
                  {persona.name.charAt(0).toUpperCase()}
                </span>
                <span className="text-sm text-slate-700">{persona.name}</span>
              </label>
            );
          })
        )}
      </div>

      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}
