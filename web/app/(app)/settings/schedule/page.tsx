"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Clock, Plus, Trash2 } from "lucide-react";

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

interface AddSlotFormProps {
  platform: "linkedin" | "x";
  onAdded: () => void;
}

function AddSlotForm({ platform, onAdded }: AddSlotFormProps) {
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState<0 | 30>(0);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [timezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(d: number) {
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (days.length === 0) {
      setError("Select at least one day.");
      return;
    }
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
      className="mt-4 space-y-5 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4"
    >
      <p className="text-sm font-semibold text-slate-800">Add custom slot</p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900"
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h.toString().padStart(2, "0")}
            </option>
          ))}
        </select>
        <span className="text-slate-500">:</span>
        <select
          value={minute}
          onChange={(e) => setMinute(Number(e.target.value) as 0 | 30)}
          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900"
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? "00" : "30"}
            </option>
          ))}
        </select>
        <span className="rounded-lg bg-white px-2 py-1 text-xs text-slate-500">{timezone}</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {DAY_LABELS.map((label, i) => (
          <button
            key={i}
            type="button"
            onClick={() => toggleDay(i)}
            className={`h-9 rounded-xl border px-3 text-xs font-semibold transition-colors ${
              days.includes(i)
                ? "border-indigo-500 bg-indigo-600 text-white"
                : "border-slate-300 bg-white text-slate-600 hover:border-indigo-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={saving}
          className="h-10 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-4 font-semibold text-white hover:opacity-95"
        >
          {saving ? "Adding…" : "Add slot"}
        </Button>
      </div>
    </form>
  );
}

interface PlatformSectionProps {
  platform: "linkedin" | "x";
  label: string;
}

function PlatformSection({ platform, label }: PlatformSectionProps) {
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

  return (
    <Card className="overflow-hidden rounded-3xl border-slate-200/80 shadow-none">
      <CardHeader className="border-b border-slate-100 pb-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                platform === "linkedin"
                  ? "bg-[#eef6ff] text-[#0077b5]"
                  : "bg-slate-100 text-slate-800"
              }`}
            >
              <span className="text-sm font-black">{platform === "linkedin" ? "in" : "X"}</span>
            </div>
            <div>
              <CardTitle className="text-lg font-bold">{label} Schedule</CardTitle>
              <CardDescription>{slots.length} active time slots</CardDescription>
            </div>
          </div>
          {!showForm ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowForm(true)}
              className="h-9 rounded-xl px-3 text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700"
            >
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          ) : null}
        </div>

      </CardHeader>
      <CardContent className="space-y-3 p-0">
        <div className="px-6 pt-4">
          <CardDescription>
            Configure preferred posting times for {label}.
          </CardDescription>
        </div>

        <div className="px-6 pb-1">
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : slots.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              No slots configured. Add one below.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200/80 bg-white">
              {slots.map((slot) => (
                <li key={slot.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <span className="font-bold">{formatHour(slot.hour, slot.minute)}</span>
                      <span className="text-xs text-slate-400">{slot.timezone}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {slot.days_of_week.map((d) => (
                        <span
                          key={`${slot.id}-${d}`}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500"
                        >
                          {DAY_LABELS[d]}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(slot.id)}
                    disabled={deletingId === slot.id}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                    title="Remove slot"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {nextTimes.length > 0 && (
          <div className="mx-6 rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              Next upcoming slots
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

        <div className="px-6 pb-6">
          {showForm ? (
            <AddSlotForm
              platform={platform}
              onAdded={async () => {
                setShowForm(false);
                await load();
              }}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm(true)}
              className="mt-2 h-10 rounded-xl"
            >
              <Plus className="mr-1 h-4 w-4" /> Add slot
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PostingSchedulePage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 rounded-3xl border border-slate-200/70 bg-white/85 p-6 shadow-[0_18px_44px_-28px_rgba(15,23,42,0.45)] backdrop-blur-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          Settings
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">
          Posting Schedule
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">
          Define your preferred posting times. When scheduling a post, these
          slots appear as one-click options.
        </p>
      </div>
      <PlatformSection platform="linkedin" label="LinkedIn" />
      <PlatformSection platform="x" label="X / Twitter" />
    </div>
  );
}
