import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@/lib/db/types";
import type { AccountGroupWithMembers } from "@/lib/db/account-groups";

// Group-form validation helpers — mirror the client island's checks without a
// DOM. Names are trimmed and must be non-empty; the membership payload sent to
// the proxy route must be shaped as { persona_ids: [...] }.
function isValidGroupName(raw: string): boolean {
  return raw.trim().length > 0;
}

function buildMembersPayload(personaIds: string[]): { persona_ids: string[] } {
  return { persona_ids: personaIds };
}

describe("group-form validation", () => {
  it("rejects empty / whitespace-only names", () => {
    expect(isValidGroupName("")).toBe(false);
    expect(isValidGroupName("   ")).toBe(false);
  });

  it("accepts a non-empty name", () => {
    expect(isValidGroupName("Founders")).toBe(true);
    expect(isValidGroupName("  Founders  ")).toBe(true);
  });

  it("shapes the membership payload as { persona_ids: [...] }", () => {
    const payload = buildMembersPayload(["p1", "p2"]);
    expect(payload).toEqual({ persona_ids: ["p1", "p2"] });
    expect(Array.isArray(payload.persona_ids)).toBe(true);
  });

  it("supports an empty membership list (unassign all)", () => {
    expect(buildMembersPayload([])).toEqual({ persona_ids: [] });
  });
});

describe("persona_groups table types", () => {
  it("Row has the expected columns", () => {
    type Row = Database["public"]["Tables"]["persona_groups"]["Row"];
    const row: Row = {
      id: "00000000-0000-0000-0000-000000000000",
      workspace_id: "00000000-0000-0000-0000-000000000001",
      name: "Founders",
      created_at: new Date().toISOString(),
    };
    expect(row.name).toBe("Founders");
  });

  it("member Row links a group to a persona", () => {
    type MemberRow =
      Database["public"]["Tables"]["persona_group_members"]["Row"];
    const member: MemberRow = {
      group_id: "00000000-0000-0000-0000-000000000000",
      persona_id: "00000000-0000-0000-0000-000000000002",
      created_at: new Date().toISOString(),
    };
    expect(member.persona_id).toBeDefined();
  });
});

// getAccountGroupsWithMembers output row shape — mock supabase (no live DB).
const fromMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: fromMock }),
}));

describe("getAccountGroupsWithMembers", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns groups each with a persona_ids string[]", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "persona_groups") {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: "g1",
                      workspace_id: "ws1",
                      name: "Founders",
                      created_at: "2026-07-18T00:00:00Z",
                    },
                    {
                      id: "g2",
                      workspace_id: "ws1",
                      name: "Empty",
                      created_at: "2026-07-18T00:00:01Z",
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        };
      }
      // persona_group_members
      return {
        select: () => ({
          in: () =>
            Promise.resolve({
              data: [
                { group_id: "g1", persona_id: "p1" },
                { group_id: "g1", persona_id: "p2" },
              ],
              error: null,
            }),
        }),
      };
    });

    const { getAccountGroupsWithMembers } = await import(
      "@/lib/db/account-groups"
    );
    const groups: AccountGroupWithMembers[] =
      await getAccountGroupsWithMembers("ws1");

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ id: "g1", name: "Founders" });
    expect(groups[0].persona_ids).toEqual(["p1", "p2"]);
    // group with no members is empty-safe
    expect(groups[1].persona_ids).toEqual([]);
    groups.forEach((g) => {
      expect(Array.isArray(g.persona_ids)).toBe(true);
      g.persona_ids.forEach((id) => expect(typeof id).toBe("string"));
    });
  });

  it("returns [] when the workspace has no groups", async () => {
    fromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }));

    const { getAccountGroupsWithMembers } = await import(
      "@/lib/db/account-groups"
    );
    expect(await getAccountGroupsWithMembers("ws1")).toEqual([]);
  });
});
