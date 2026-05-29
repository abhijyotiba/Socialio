import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/db/types";

// Type-level tests — verify the content-engine tables appear in the generated
// types with the expected columns. No live Supabase connection required.

describe("content_ideas table types", () => {
  it("Row has all expected columns", () => {
    type Row = Database["public"]["Tables"]["content_ideas"]["Row"];
    const row: Row = {
      id: "00000000-0000-0000-0000-000000000000",
      workspace_id: "00000000-0000-0000-0000-000000000000",
      ingestion_job_id: "00000000-0000-0000-0000-000000000001",
      essence: "Most onboarding flows lose users at step 3.",
      idea_type: "stat",
      source_quote: "40% drop off at the third step.",
      strength: 4,
      suitable_formats: ["hot_take"],
      suitable_angles: ["expert"],
      created_at: new Date().toISOString(),
    };
    expect(row.idea_type).toBe("stat");
    expect(row.strength).toBe(4);
  });
});

describe("content_cadences table types", () => {
  it("Row has the set-it-once config columns", () => {
    type Row = Database["public"]["Tables"]["content_cadences"]["Row"];
    const row: Row = {
      id: "00000000-0000-0000-0000-000000000000",
      workspace_id: "00000000-0000-0000-0000-000000000000",
      persona_id: "00000000-0000-0000-0000-000000000002",
      platform: "linkedin",
      posts_per_week: 3,
      autopilot_enabled: false,
      active: true,
      low_reservoir_threshold: 5,
      last_low_nudge_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(row.autopilot_enabled).toBe(false);
    expect(row.posts_per_week).toBe(3);
  });

  it("Insert allows the documented defaults to be omitted", () => {
    type Insert = Database["public"]["Tables"]["content_cadences"]["Insert"];
    const insert: Insert = {
      workspace_id: "00000000-0000-0000-0000-000000000000",
      persona_id: "00000000-0000-0000-0000-000000000002",
      platform: "x",
    };
    expect(insert.platform).toBe("x");
    expect(insert.posts_per_week).toBeUndefined();
  });
});

describe("content_items matrix columns", () => {
  it("Row exposes the matrix-cell columns (nullable for legacy rows)", () => {
    type Row = Database["public"]["Tables"]["content_items"]["Row"];
    // Only assert the new columns are present/typed; legacy columns vary.
    const partial: Pick<
      Row,
      "idea_id" | "persona_id" | "format" | "angle" | "platform" | "status" | "matrix_cell_hash"
    > = {
      idea_id: null,
      persona_id: null,
      format: null,
      angle: null,
      platform: null,
      status: null,
      matrix_cell_hash: null,
    };
    expect(partial.matrix_cell_hash).toBeNull();
  });
});
