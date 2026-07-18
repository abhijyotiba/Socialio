import { describe, it, expect, vi, beforeEach } from "vitest";

// Records the query-builder calls so we can assert on the filters the helper
// applies, and controls the resolved rows. Every builder method returns the
// same chainable object; awaiting it yields { data, error }.
const calls: {
  from?: string;
  select?: string;
  eq: Array<[string, unknown]>;
  not: Array<[string, string, unknown]>;
  order: Array<[string, unknown]>;
} = { eq: [], not: [], order: [] };

let resolved: { data: unknown; error: unknown } = { data: [], error: null };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  builder.select = (sel: string) => {
    calls.select = sel;
    return builder;
  };
  builder.eq = (col: string, val: unknown) => {
    calls.eq.push([col, val]);
    return builder;
  };
  builder.not = (col: string, op: string, val: unknown) => {
    calls.not.push([col, op, val]);
    return builder;
  };
  builder.order = (col: string, opts: unknown) => {
    calls.order.push([col, opts]);
    return Promise.resolve(resolved);
  };
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      calls.from = table;
      return makeBuilder();
    },
  }),
}));

import { getTerminalFailures } from "@/lib/db/post-failures";

describe("getTerminalFailures", () => {
  beforeEach(() => {
    calls.from = undefined;
    calls.select = undefined;
    calls.eq = [];
    calls.not = [];
    calls.order = [];
    resolved = { data: [], error: null };
  });

  it("queries post_variants filtered to failed_terminal + non-null error/error_code, scoped to the workspace", async () => {
    await getTerminalFailures("ws1");

    expect(calls.from).toBe("post_variants");
    // Scoped to the workspace and only terminal failures.
    expect(calls.eq).toContainEqual(["workspace_id", "ws1"]);
    expect(calls.eq).toContainEqual(["status", "failed_terminal"]);
    // error and error_code must be present for a terminal failure.
    expect(calls.not).toContainEqual(["error", "is", null]);
    expect(calls.not).toContainEqual(["error_code", "is", null]);
    // Pulls the persona + campaign chain for the banner.
    expect(calls.select).toContain("persona:personas");
    expect(calls.select).toContain("campaign_persona_variants");
  });

  it("maps rows to the light TerminalFailure shape and unwraps embedded joins", async () => {
    resolved = {
      data: [
        {
          id: "pv1",
          platform: "linkedin",
          error_code: "token_revoked",
          persona: { name: "Acme", avatar_color: "#f00" },
          campaign_persona_variants: [
            { campaign_personas: { campaign_id: "camp1" } },
          ],
        },
        {
          // persona + campaign returned as single objects (not arrays)
          id: "pv2",
          platform: "x",
          error_code: "duplicate",
          persona: [{ name: "Beta", avatar_color: "#00f" }],
          campaign_persona_variants: [
            { campaign_personas: [{ campaign_id: "camp2" }] },
          ],
        },
      ],
      error: null,
    };

    const rows = await getTerminalFailures("ws1");

    expect(rows).toEqual([
      {
        post_variant_id: "pv1",
        persona_name: "Acme",
        avatar_color: "#f00",
        platform: "linkedin",
        error_code: "token_revoked",
        campaign_id: "camp1",
      },
      {
        post_variant_id: "pv2",
        persona_name: "Beta",
        avatar_color: "#00f",
        platform: "x",
        error_code: "duplicate",
        campaign_id: "camp2",
      },
    ]);
  });

  it("returns an empty array when no terminal failures exist", async () => {
    resolved = { data: [], error: null };
    expect(await getTerminalFailures("ws1")).toEqual([]);
  });

  it("falls back to a null campaign_id when the variant has no campaign link", async () => {
    resolved = {
      data: [
        {
          id: "pv3",
          platform: "linkedin",
          error_code: "rate_limited",
          persona: { name: "Gamma", avatar_color: "#0f0" },
          campaign_persona_variants: null,
        },
      ],
      error: null,
    };

    const rows = await getTerminalFailures("ws1");
    expect(rows[0].campaign_id).toBeNull();
  });

  it("throws when the query errors", async () => {
    resolved = { data: null, error: { message: "boom" } };
    await expect(getTerminalFailures("ws1")).rejects.toBeTruthy();
  });
});
