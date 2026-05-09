import { describe, it, expect } from "vitest";
import { nextSlots, type PostingScheduleRow } from "@/lib/db/schedule-utils";

function makeSchedule(
  overrides: Partial<PostingScheduleRow> = {}
): PostingScheduleRow {
  return {
    id: "test-id",
    workspace_id: "ws-1",
    persona_id: "00000000-0000-0000-0000-000000000001",
    platform: "linkedin",
    hour: 9,
    minute: 0,
    days_of_week: [1, 2, 3, 4, 5], // Mon-Fri
    timezone: "UTC",
    is_active: true,
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("nextSlots()", () => {
  it("returns empty array when no schedules are provided", () => {
    const result = nextSlots([], 5, new Date("2024-01-15T08:00:00Z")); // Monday UTC
    expect(result).toEqual([]);
  });

  it("returns empty array when all schedules are inactive", () => {
    const schedule = makeSchedule({ is_active: false });
    const result = nextSlots([schedule], 5, new Date("2024-01-15T08:00:00Z"));
    expect(result).toEqual([]);
  });

  it("returns the next Mon-Fri 9am UTC slot correctly", () => {
    const schedule = makeSchedule(); // Mon-Fri 9am UTC
    // Monday 2024-01-15 at 08:00 UTC → next slot is 09:00 same day
    const after = new Date("2024-01-15T08:00:00Z");
    const [slot] = nextSlots([schedule], 1, after);
    expect(slot.toISOString()).toBe("2024-01-15T09:00:00.000Z");
  });

  it("skips a slot that has already passed today and returns next day", () => {
    const schedule = makeSchedule(); // Mon-Fri 9am UTC
    // Monday 2024-01-15 at 10:00 UTC → 9am already passed, next is Tue 9am
    const after = new Date("2024-01-15T10:00:00Z");
    const [slot] = nextSlots([schedule], 1, after);
    expect(slot.toISOString()).toBe("2024-01-16T09:00:00.000Z"); // Tuesday
  });

  it("skips weekend days when days_of_week is Mon-Fri", () => {
    const schedule = makeSchedule(); // Mon-Fri 9am UTC
    // Friday 2024-01-19 at 10:00 UTC → skip Sat/Sun, next is Mon 2024-01-22
    const after = new Date("2024-01-19T10:00:00Z");
    const [slot] = nextSlots([schedule], 1, after);
    expect(slot.toISOString()).toBe("2024-01-22T09:00:00.000Z"); // Monday
  });

  it("respects the count parameter", () => {
    const schedule = makeSchedule({ days_of_week: [0, 1, 2, 3, 4, 5, 6] }); // every day 9am
    const after = new Date("2024-01-15T10:00:00Z"); // Monday, post-9am
    const result = nextSlots([schedule], 3, after);
    expect(result).toHaveLength(3);
    expect(result[0].toISOString()).toBe("2024-01-16T09:00:00.000Z"); // Tue
    expect(result[1].toISOString()).toBe("2024-01-17T09:00:00.000Z"); // Wed
    expect(result[2].toISOString()).toBe("2024-01-18T09:00:00.000Z"); // Thu
  });

  it("returns results sorted ascending", () => {
    const morning = makeSchedule({ hour: 9, minute: 0, days_of_week: [1, 2, 3, 4, 5] });
    const evening = makeSchedule({ hour: 17, minute: 0, days_of_week: [1, 2, 3, 4, 5] });
    const after = new Date("2024-01-15T08:00:00Z"); // Mon 8am
    const slots = nextSlots([evening, morning], 2, after); // deliberate reverse order
    expect(slots[0].getTime()).toBeLessThan(slots[1].getTime());
    expect(slots[0].toISOString()).toBe("2024-01-15T09:00:00.000Z");
    expect(slots[1].toISOString()).toBe("2024-01-15T17:00:00.000Z");
  });

  it("deduplicates slots falling on the same minute", () => {
    const s1 = makeSchedule({ id: "s1", platform: "linkedin" });
    const s2 = makeSchedule({ id: "s2", platform: "x" });
    const after = new Date("2024-01-15T08:00:00Z");
    // Both schedules resolve to Mon 09:00 UTC as their first slot.
    // With count=1 we should get exactly 1 result, not 2.
    const result = nextSlots([s1, s2], 1, after);
    expect(result).toHaveLength(1);
    expect(result[0].toISOString()).toBe("2024-01-15T09:00:00.000Z");
  });

  it("converts non-UTC timezone slots to correct UTC datetimes", () => {
    // 9am America/New_York = 14:00 UTC (EST, UTC-5) in January
    const schedule = makeSchedule({
      hour: 9,
      minute: 0,
      days_of_week: [1, 2, 3, 4, 5],
      timezone: "America/New_York",
    });
    const after = new Date("2024-01-15T13:00:00Z"); // Mon 8am EST (before 9am)
    const [slot] = nextSlots([schedule], 1, after);
    expect(slot.toISOString()).toBe("2024-01-15T14:00:00.000Z"); // 9am EST = 14:00 UTC
  });

  it("handles half-hour slots correctly", () => {
    const schedule = makeSchedule({ hour: 12, minute: 30, days_of_week: [0, 1, 2, 3, 4, 5, 6] });
    const after = new Date("2024-01-15T12:00:00Z");
    const [slot] = nextSlots([schedule], 1, after);
    expect(slot.toISOString()).toBe("2024-01-15T12:30:00.000Z");
  });
});
