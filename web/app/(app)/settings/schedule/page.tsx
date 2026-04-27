"use client";

import { useEffect, useState, useCallback } from "react";
import { CalendarClock, Clock, Plus, Trash2, Loader2, X, ChevronDown } from "lucide-react";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 30];

function formatHour(hour: number, minute: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const m = minute === 0 ? "00" : "30";
  return `${h}:${m} ${period}`;
}

interface Slot {
  id: string;
  platform: "linkedin" | "x";
  hour: number;
  minute: number;
  days_of_week: number[];
  timezone: string;
  is_active: boolean;
}

function AddSlotForm({ platform, onAdded, onCancel }: {
  platform: "linkedin" | "x";
  onAdded: () => void;
  onCancel: () => void;
}) {
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState<0 | 30>(0);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [timezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(d: number) {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (days.length === 0) { setError("Select at least one day."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/schedule-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, hour, minute, days_of_week: days, timezone }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to add slot");
      }
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add slot");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-700">New time slot</p>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Time pickers */}
      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
            className="h-9 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-7 text-sm font-semibold text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>{h.toString().padStart(2, "0")}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
        </div>
        <span className="text-sm font-bold text-slate-400">:</span>
        <div className="relative">
          <select
            value={minute}
            onChange={(e) => setMinute(Number(e.target.value) as 0 | 30)}
            className="h-9 appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-7 text-sm font-semibold text-slate-900 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            {MINUTES.map((m) => (
              <option key={m} value={m}>{m === 0 ? "00" : "30"}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
        </div>
        <span className="rounded-lg bg-white border border-slate-200 px-2.5 py-1.5 text-[10px] font-medium text-slate-500">
          {timezone}
        </span>
      </div>

      {/* Day toggles */}
      <div className="flex flex-wrap gap-1.5">
        {DAY_LABELS.map((label, i) => (
          <button
            key={i}
            type="button"
            onClick={() => toggleDay(i)}
            className={`h-8 min-w-[2.5rem] rounded-lg px-2.5 text-xs font-bold transition-all ${
              days.includes(i)
                ? "bg-indigo-600 text-white shadow-sm"
                : "border border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        type="submit"
        disabled={saving}
        className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
        {saving ? "Adding…" : "Add slot"}
      </button>
    </form>
  );
}

function PlatformSection({ platform, label }: { platform: "linkedin" | "x"; label: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [nextTimes, setNextTimes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/schedule-slots?platform=${platform}`);
      if (!res.ok) return;
      const body = await res.json();
      setSlots(body.slots ?? []);
      setNextTimes(body.next ?? []);
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial page load hydrates schedule state from API
    load();
  }, [load]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/schedule-slots/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setDeletingId(null);
    }
  }

  const isLinkedIn = platform === "linkedin";

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      {/* Section header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
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
            <p className="text-[11px] text-slate-400">
              {loading ? "Loading…" : `${slots.length} active slot${slots.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600"
          >
            <Plus className="h-3.5 w-3.5" />
            Add slot
          </button>
        )}
      </div>

      {/* Slots list */}
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        </div>
      ) : slots.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 py-8 text-center">
          <Clock className="mb-2 h-5 w-5 text-slate-300" />
          <p className="text-xs font-medium text-slate-500">No time slots configured</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            <Plus className="h-3 w-3" />
            Add first slot
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {slots.map((slot) => (
            <div
              key={slot.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center gap-1.5 shrink-0">
                  <Clock className="h-3.5 w-3.5 text-indigo-400" />
                  <span className="text-sm font-bold text-slate-800">
                    {formatHour(slot.hour, slot.minute)}
                  </span>
                </div>
                <div className="h-3.5 w-px bg-slate-200 shrink-0" />
                <div className="flex flex-wrap gap-1 min-w-0">
                  {slot.days_of_week.map((d) => (
                    <span
                      key={`${slot.id}-${d}`}
                      className="rounded-md bg-white border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500"
                    >
                      {DAY_LABELS[d]}
                    </span>
                  ))}
                </div>
                <span className="shrink-0 text-[10px] text-slate-400 hidden sm:block">
                  {slot.timezone}
                </span>
              </div>
              <button
                onClick={() => handleDelete(slot.id)}
                disabled={deletingId === slot.id}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                title="Remove slot"
              >
                {deletingId === slot.id
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Trash2 className="h-3.5 w-3.5" />
                }
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <AddSlotForm
          platform={platform}
          onAdded={async () => { setShowForm(false); await load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Next upcoming slots */}
      {nextTimes.length > 0 && !showForm && (
        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            Next upcoming
          </p>
          <ul className="space-y-0.5">
            {nextTimes.slice(0, 3).map((t) => (
              <li key={t} className="text-xs text-slate-500">
                {new Date(t).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PostingSchedulePage() {
  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
          <CalendarClock className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Posting Schedule</h1>
          <p className="text-xs text-slate-400">
            Define preferred posting times — these appear as one-click options when scheduling.
          </p>
        </div>
      </div>

      <PlatformSection platform="linkedin" label="LinkedIn" />
      <PlatformSection platform="x" label="X / Twitter" />
    </div>
  );
}
