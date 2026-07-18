import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GridVariantRow } from "@/lib/campaigns/grid";

// A chainable stub that mimics the PostgREST query builder: every method
// returns `this`, and awaiting the builder (or calling .range) resolves to the
// configured result. No live Supabase.
function makeQuery(result: { data: unknown; count?: number }) {
  const builder: Record<string, unknown> = {};
  const passthrough = () => builder;
  for (const m of ["select", "eq", "in", "order", "single"]) {
    builder[m] = vi.fn(passthrough);
  }
  builder.range = vi.fn(async () => result);
  // `single` should resolve directly (used by the header campaign read etc.).
  builder.single = vi.fn(async () => result);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return builder;
}

const fromMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: fromMock }),
}));

// Detail helpers are exercised elsewhere; stub them so getVariantDetail's
// composition can be asserted without their own queries.
vi.mock("@/lib/db/post-variant-revisions", () => ({
  listRevisionsForVariant: vi.fn(async () => []),
}));
vi.mock("@/lib/db/post-variant-media", () => ({
  getVariantMedia: vi.fn(async () => []),
}));
vi.mock("@/lib/db/posts", () => ({
  getVariantSource: vi.fn(async () => null),
}));

describe("listCampaignVariants", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns light rows with a truncated body_preview and NO full body field", async () => {
    const longBody = "x".repeat(300);
    fromMock.mockReturnValue(
      makeQuery({
        count: 1,
        data: [
          {
            post_variant_id: "v1",
            platform: "linkedin",
            created_at: "2026-07-18T00:00:00Z",
            campaign_personas: {
              persona_id: "p1",
              personas: { name: "Alice", avatar_color: "#123456" },
            },
            post_variants: { status: "draft", body: longBody },
          },
        ],
      })
    );

    const { listCampaignVariants } = await import("@/lib/db/campaign-variants");
    const res = await listCampaignVariants("c1", { page: 1, pageSize: 25 });

    expect(res.total).toBe(1);
    expect(res.rows).toHaveLength(1);
    const row = res.rows[0];

    // Shape assertion: the light row exposes body_preview, never `body`.
    const expectedKeys: (keyof GridVariantRow)[] = [
      "persona_id",
      "persona_name",
      "avatar_color",
      "platform",
      "post_variant_id",
      "status",
      "body_preview",
    ];
    expect(Object.keys(row).sort()).toEqual([...expectedKeys].sort());
    expect(row).not.toHaveProperty("body");

    // Preview is truncated (120 chars + ellipsis), not the full 300-char body.
    expect(row.body_preview.length).toBeLessThan(longBody.length);
    expect(row.body_preview.endsWith("…")).toBe(true);
    expect(row.persona_name).toBe("Alice");
    expect(row.avatar_color).toBe("#123456");
  });

  it("does not truncate a short body", async () => {
    fromMock.mockReturnValue(
      makeQuery({
        count: 1,
        data: [
          {
            post_variant_id: "v2",
            platform: "x",
            created_at: "2026-07-18T00:00:00Z",
            campaign_personas: { persona_id: "p1", personas: { name: "Bo", avatar_color: "#000" } },
            post_variants: { status: "approved", body: "short" },
          },
        ],
      })
    );
    const { listCampaignVariants } = await import("@/lib/db/campaign-variants");
    const res = await listCampaignVariants("c1", {});
    expect(res.rows[0].body_preview).toBe("short");
  });
});

describe("getCampaignHeader", () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it("returns counts and personas without loading variant bodies", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "campaigns") {
        return makeQuery({
          data: { id: "c1", workspace_id: "ws1", status: "pending_approval", title: "T" },
        });
      }
      if (table === "campaign_personas") {
        return makeQuery({
          data: [
            {
              persona_id: "p1",
              approval_status: "pending",
              personas: { id: "p1", name: "Alice", avatar_color: "#111", slug: "alice" },
            },
          ],
        });
      }
      // campaign_persona_variants → status rows only
      return makeQuery({
        data: [
          { post_variants: { status: "draft" } },
          { post_variants: { status: "approved" } },
          { post_variants: { status: "scheduled" } },
        ],
      });
    });

    const { getCampaignHeader } = await import("@/lib/db/campaign-variants");
    const header = await getCampaignHeader("c1");
    expect(header).not.toBeNull();
    expect(header!.counts.total).toBe(3);
    expect(header!.counts.approved).toBe(2); // approved + scheduled
    expect(header!.counts.byStatus).toEqual({ draft: 1, approved: 1, scheduled: 1 });
    expect(header!.personas[0].name).toBe("Alice");
    // Persona metadata carries no body.
    expect(header!.personas[0]).not.toHaveProperty("body");
  });
});
