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

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 30];

function formatHour(hour: number, minute: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const m = minute === 0 ? "00" : "30";
  return `${h}:${m} ${period}`;
}

function formatDays(days: number[]): string {
  if (days.length === 7) return "Every day";
  if (
    days.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => days.includes(d)) &&
    !days.includes(0) &&
    !days.includes(6)
  )
    return "Mon–Fri";
  if (
    days.length === 2 &&
    days.includes(0) &&
    days.includes(6) &&
    days.every((d) => [0, 6].includes(d))
  )
    return "Weekends";
  return days.map((d) => DAY_LABELS[d]).join(", ");
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
    <form onSubmit={handleSubmit} className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-4 mt-4">
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Add slot</p>

      <div className="flex gap-3 items-center">
        <select
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50"
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h.toString().padStart(2, "0")}
            </option>
          ))}
        </select>
        <span className="text-zinc-500">:</span>
        <select
          value={minute}
          onChange={(e) => setMinute(Number(e.target.value) as 0 | 30)}
          className="text-sm border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1.5 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50"
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? "00" : "30"}
            </option>
          ))}
        </select>
        <span className="text-xs text-zinc-400">{timezone}</span>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {DAY_LABELS.map((label, i) => (
          <button
            key={i}
            type="button"
            onClick={() => toggleDay(i)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              days.includes(i)
                ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-50"
                : "border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:border-zinc-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
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
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>
          Configure preferred posting times for {label}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : slots.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No slots configured. Add one below.
          </p>
        ) : (
          <ul className="space-y-2">
            {slots.map((slot) => (
              <li
                key={slot.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-zinc-800 dark:text-zinc-200">
                  {formatDays(slot.days_of_week)}{" "}
                  <span className="font-medium">
                    {formatHour(slot.hour, slot.minute)}
                  </span>{" "}
                  <span className="text-xs text-zinc-400">{slot.timezone}</span>
                </span>
                <button
                  onClick={() => handleDelete(slot.id)}
                  disabled={deletingId === slot.id}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40"
                >
                  {deletingId === slot.id ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {nextTimes.length > 0 && (
          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-xs text-zinc-400 mb-1">Next upcoming slots</p>
            <ul className="space-y-0.5">
              {nextTimes.slice(0, 3).map((t) => (
                <li key={t} className="text-xs text-zinc-500">
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
            className="mt-2"
          >
            + Add slot
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function PostingSchedulePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Posting Schedule
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Define your preferred posting times. When scheduling a post, these
          slots appear as one-click options.
        </p>
      </div>
      <PlatformSection platform="linkedin" label="LinkedIn" />
      <PlatformSection platform="x" label="X / Twitter" />
    </div>
  );
}
