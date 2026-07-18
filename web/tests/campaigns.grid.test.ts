import { describe, it, expect } from "vitest";
import {
  filterVariants,
  sortVariants,
  orderedVariants,
  selectionReducer,
  emptySelection,
  isPageFullySelected,
  selectedCount,
  progressFromCounts,
  progressFromRows,
  isApprovedStatus,
  DEFAULT_SORT,
  type GridVariantRow,
  type SelectionState,
} from "@/lib/campaigns/grid";

function row(overrides: Partial<GridVariantRow> = {}): GridVariantRow {
  return {
    persona_id: "p1",
    persona_name: "Alice",
    avatar_color: "#000",
    platform: "linkedin",
    post_variant_id: "v1",
    status: "draft",
    body_preview: "hello",
    ...overrides,
  };
}

const rows: GridVariantRow[] = [
  row({ post_variant_id: "v1", persona_name: "Bob", platform: "x", status: "draft" }),
  row({ post_variant_id: "v2", persona_name: "Alice", platform: "linkedin", status: "approved" }),
  row({ post_variant_id: "v3", persona_name: "Alice", platform: "x", status: "scheduled" }),
  row({ post_variant_id: "v4", persona_id: "p2", persona_name: "Carol", platform: "linkedin", status: "draft" }),
];

describe("filterVariants", () => {
  it("returns all rows with no filters", () => {
    expect(filterVariants(rows)).toHaveLength(4);
  });

  it("filters by status", () => {
    const out = filterVariants(rows, { status: "draft" });
    expect(out.map((r) => r.post_variant_id)).toEqual(["v1", "v4"]);
  });

  it("filters by platform", () => {
    const out = filterVariants(rows, { platform: "x" });
    expect(out.map((r) => r.post_variant_id)).toEqual(["v1", "v3"]);
  });

  it("filters by persona_id", () => {
    const out = filterVariants(rows, { persona_id: "p2" });
    expect(out.map((r) => r.post_variant_id)).toEqual(["v4"]);
  });

  it("combines filters (AND)", () => {
    const out = filterVariants(rows, { platform: "linkedin", status: "draft" });
    expect(out.map((r) => r.post_variant_id)).toEqual(["v4"]);
  });
});

describe("sortVariants", () => {
  it("sorts by persona (name then platform) ascending by default", () => {
    const out = sortVariants(rows, DEFAULT_SORT);
    // Alice/linkedin, Alice/x, Bob/x, Carol/linkedin
    expect(out.map((r) => r.post_variant_id)).toEqual(["v2", "v3", "v1", "v4"]);
  });

  it("reverses order when dir is desc", () => {
    const out = sortVariants(rows, { key: "persona", dir: "desc" });
    expect(out.map((r) => r.post_variant_id)).toEqual(["v4", "v1", "v3", "v2"]);
  });

  it("sorts by status ascending", () => {
    const out = sortVariants(rows, { key: "status", dir: "asc" });
    // approved, draft, draft, scheduled
    expect(out.map((r) => r.status)).toEqual([
      "approved",
      "draft",
      "draft",
      "scheduled",
    ]);
  });

  it("sorts by platform ascending", () => {
    const out = sortVariants(rows, { key: "platform", dir: "asc" });
    expect(out.map((r) => r.platform)).toEqual(["linkedin", "linkedin", "x", "x"]);
  });

  it("is stable via post_variant_id tiebreak", () => {
    const same = [
      row({ post_variant_id: "b", persona_name: "Z", platform: "x" }),
      row({ post_variant_id: "a", persona_name: "Z", platform: "x" }),
    ];
    const out = sortVariants(same, { key: "persona", dir: "asc" });
    expect(out.map((r) => r.post_variant_id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    sortVariants(input);
    expect(input.map((r) => r.post_variant_id)).toEqual(["v1", "v2", "v3", "v4"]);
  });
});

describe("orderedVariants", () => {
  it("filters then sorts into the rendered subset", () => {
    const out = orderedVariants(rows, {
      filters: { platform: "x" },
      sort: { key: "persona", dir: "asc" },
    });
    // Only x-platform rows: Alice/x (v3), Bob/x (v1)
    expect(out.map((r) => r.post_variant_id)).toEqual(["v3", "v1"]);
  });
});

describe("selectionReducer", () => {
  it("toggle adds then removes an id", () => {
    let s: SelectionState = emptySelection;
    s = selectionReducer(s, { type: "toggle", id: "v1" });
    expect([...s.ids]).toEqual(["v1"]);
    s = selectionReducer(s, { type: "toggle", id: "v1" });
    expect([...s.ids]).toEqual([]);
  });

  it("select-page unions ids into the selection", () => {
    let s: SelectionState = selectionReducer(emptySelection, {
      type: "toggle",
      id: "x",
    });
    s = selectionReducer(s, { type: "select-page", ids: ["v1", "v2"] });
    expect([...s.ids].sort()).toEqual(["v1", "v2", "x"]);
  });

  it("select-all-matching replaces the selection with the supplied ids", () => {
    let s: SelectionState = selectionReducer(emptySelection, {
      type: "toggle",
      id: "old",
    });
    s = selectionReducer(s, {
      type: "select-all-matching",
      ids: ["v1", "v2", "v3"],
    });
    expect([...s.ids].sort()).toEqual(["v1", "v2", "v3"]);
  });

  it("clear empties the selection", () => {
    let s: SelectionState = selectionReducer(emptySelection, {
      type: "select-page",
      ids: ["v1", "v2"],
    });
    s = selectionReducer(s, { type: "clear" });
    expect(selectedCount(s)).toBe(0);
  });
});

describe("isPageFullySelected", () => {
  it("is true only when every page id is selected", () => {
    const s = selectionReducer(emptySelection, {
      type: "select-page",
      ids: ["v1", "v2"],
    });
    expect(isPageFullySelected(s, ["v1", "v2"])).toBe(true);
    expect(isPageFullySelected(s, ["v1", "v2", "v3"])).toBe(false);
  });

  it("is false for an empty page", () => {
    expect(isPageFullySelected(emptySelection, [])).toBe(false);
  });
});

describe("progress", () => {
  it("progressFromCounts computes percentage", () => {
    expect(progressFromCounts(3, 12)).toEqual({ approved: 3, total: 12, pct: 25 });
  });

  it("progressFromCounts handles zero total", () => {
    expect(progressFromCounts(0, 0)).toEqual({ approved: 0, total: 0, pct: 0 });
  });

  it("progressFromRows counts approved-ish statuses", () => {
    // rows has: draft, approved, scheduled, draft → 2 approved of 4
    const p = progressFromRows(rows);
    expect(p).toEqual({ approved: 2, total: 4, pct: 50 });
  });

  it("isApprovedStatus treats scheduled/published as approved", () => {
    expect(isApprovedStatus("approved")).toBe(true);
    expect(isApprovedStatus("scheduled")).toBe(true);
    expect(isApprovedStatus("published")).toBe(true);
    expect(isApprovedStatus("draft")).toBe(false);
    expect(isApprovedStatus("pending_approval")).toBe(false);
  });
});
