import type { Tables } from "@/lib/db/types";

export type PostingScheduleRow = Tables<"posting_schedules">;

// Extract local date/time parts for a UTC instant in a given IANA timezone.
function getDateParts(
  date: Date,
  timezone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value])
  );

  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    // Intl may return "24" for midnight in some environments — normalise it.
    hour: parseInt(parts.hour, 10) % 24,
    minute: parseInt(parts.minute, 10),
    dayOfWeek: dowMap[parts.weekday] ?? 0,
  };
}

// Convert a local calendar date + time in the given timezone to a UTC Date.
// Uses the "estimate then correct for offset" technique, which is accurate for
// all slots except the ambiguous hour during a fall-back DST transition (where
// the error is at most one hour — acceptable for scheduling purposes).
function zonedToUTC(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): Date {
  const estimated = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const localParts = getDateParts(estimated, timezone);
  const offsetMs =
    Date.UTC(
      localParts.year,
      localParts.month - 1,
      localParts.day,
      localParts.hour,
      localParts.minute
    ) - estimated.getTime();
  const targetLocalMs = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(targetLocalMs - offsetMs);
}

// Return the next UTC datetime when the given schedule slot fires after `after`.
function nextOccurrence(
  schedule: PostingScheduleRow,
  after: Date
): Date | null {
  const { hour, minute, timezone } = schedule;
  const days = schedule.days_of_week as number[];
  if (!days || days.length === 0) return null;

  // Scan up to 8 days ahead (7 covers every day of the week + today).
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const checkMs = after.getTime() + daysAhead * 86_400_000;
    const parts = getDateParts(new Date(checkMs), timezone);

    if (!days.includes(parts.dayOfWeek)) continue;

    const slotUTC = zonedToUTC(parts.year, parts.month, parts.day, hour, minute, timezone);
    if (slotUTC > after) return slotUTC;
  }

  return null;
}

// Return up to `count` occurrences of a single schedule after `after`.
function multipleOccurrences(
  schedule: PostingScheduleRow,
  count: number,
  after: Date
): Date[] {
  const results: Date[] = [];
  let from = after;
  while (results.length < count) {
    const next = nextOccurrence(schedule, from);
    if (!next) break;
    results.push(next);
    // Advance one minute past this slot so the next iteration finds the following one.
    from = new Date(next.getTime() + 60_000);
  }
  return results;
}

/**
 * Given a list of posting_schedules rows, return the next `count` UTC
 * datetimes when a post would fire, sorted ascending and deduplicated to
 * the nearest minute.
 */
export function nextSlots(
  schedules: PostingScheduleRow[],
  count: number = 5,
  after: Date = new Date()
): Date[] {
  const candidates: Date[] = [];

  for (const schedule of schedules) {
    if (!schedule.is_active) continue;
    // Each schedule contributes up to `count` candidates.
    candidates.push(...multipleOccurrences(schedule, count, after));
  }

  // Deduplicate slots that fall on the same minute.
  const byMinute = new Map<number, Date>();
  for (const d of candidates) {
    const key = Math.floor(d.getTime() / 60_000);
    if (!byMinute.has(key)) byMinute.set(key, d);
  }

  const sorted = [...byMinute.values()].sort((a, b) => a.getTime() - b.getTime());
  return sorted.slice(0, count);
}
