import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/db/types";

// Smoke test: verifies the generated types file is structurally correct and
// the three Phase 0 tables are present with their expected columns.

describe("Database types", () => {
  it("profiles table has expected columns", () => {
    type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
    const row: ProfileRow = {
      id: "00000000-0000-0000-0000-000000000000",
      full_name: "Test User",
      avatar_url: null,
      created_at: new Date().toISOString(),
    };
    expect(row.id).toBeDefined();
    expect(row.full_name).toBeDefined();
  });

  it("workspaces table has expected columns", () => {
    type WorkspaceRow = Database["public"]["Tables"]["workspaces"]["Row"];
    const row: WorkspaceRow = {
      id: "00000000-0000-0000-0000-000000000000",
      name: "Test workspace",
      created_at: new Date().toISOString(),
    };
    expect(row.id).toBeDefined();
    expect(row.name).toBeDefined();
  });

  it("workspace_members table has expected columns", () => {
    type MemberRow = Database["public"]["Tables"]["workspace_members"]["Row"];
    const row: MemberRow = {
      workspace_id: "00000000-0000-0000-0000-000000000000",
      user_id: "00000000-0000-0000-0000-000000000000",
      role: "owner",
      joined_at: new Date().toISOString(),
    };
    expect(row.role).toBe("owner");
  });
});
