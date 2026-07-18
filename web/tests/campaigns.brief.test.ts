import { describe, it, expect } from "vitest";
import {
  buildCampaignPayload,
  type BriefFields,
  type PersonaSelection,
  type PlatformSelection,
} from "@/lib/campaigns/brief";

function personas(
  overrides: Partial<PersonaSelection> = {}
): PersonaSelection {
  return {
    selectedPersonaIds: ["p1"],
    selectedGroups: [],
    allPersonaIds: ["p1", "p2", "p3"],
    ...overrides,
  };
}

function platforms(
  overrides: Partial<PlatformSelection> = {}
): PlatformSelection {
  return {
    selected: ["linkedin", "x"],
    connected: ["linkedin", "x"],
    ...overrides,
  };
}

describe("buildCampaignPayload()", () => {
  it("maps every field into the worker contract shape", () => {
    const fields: BriefFields = {
      goal: "Grow awareness",
      coreMessage: "We ship fast",
      tone: "confident",
      cta: "Book a demo",
      dos: ["use data", "be concise"],
      donts: ["no jargon"],
      mediaAssetIds: ["m1", "m2"],
      userAngle: "skeptical take",
      windowStart: "2026-08-01T09:00:00.000Z",
      windowEnd: "2026-08-05T17:00:00.000Z",
    };

    const payload = buildCampaignPayload(fields, personas(), platforms());

    expect(payload).toEqual({
      persona_ids: ["p1"],
      platforms: ["linkedin", "x"],
      user_angle: "skeptical take",
      brief: {
        goal: "Grow awareness",
        core_message: "We ship fast",
        tone: "confident",
        cta: "Book a demo",
        do: ["use data", "be concise"],
        dont: ["no jargon"],
        media_asset_ids: ["m1", "m2"],
      },
      window_start: "2026-08-01T09:00:00.000Z",
      window_end: "2026-08-05T17:00:00.000Z",
    });
  });

  it("uses the exact worker keys do/dont (not dos/donts)", () => {
    const payload = buildCampaignPayload(
      { dos: ["a"], donts: ["b"] },
      personas(),
      platforms()
    );
    expect(payload.brief).toHaveProperty("do", ["a"]);
    expect(payload.brief).toHaveProperty("dont", ["b"]);
    expect(payload.brief).not.toHaveProperty("dos");
    expect(payload.brief).not.toHaveProperty("donts");
  });

  it("omits empty optionals: no brief key when nothing is set", () => {
    const payload = buildCampaignPayload({}, personas(), platforms());
    expect(payload).not.toHaveProperty("brief");
    expect(payload).not.toHaveProperty("user_angle");
    expect(payload).not.toHaveProperty("window_start");
    expect(payload).not.toHaveProperty("window_end");
  });

  it("omits empty-string / blank-only fields rather than sending them", () => {
    const fields: BriefFields = {
      goal: "   ",
      coreMessage: "",
      cta: "\t",
      dos: ["", "  "],
      donts: [],
      mediaAssetIds: [""],
      userAngle: "  ",
      windowStart: "",
    };
    const payload = buildCampaignPayload(fields, personas(), platforms());
    expect(payload).not.toHaveProperty("brief");
    expect(payload).not.toHaveProperty("user_angle");
    expect(payload).not.toHaveProperty("window_start");
  });

  it("emits a partial brief with only the set keys", () => {
    const payload = buildCampaignPayload(
      { goal: "Launch", cta: "Sign up" },
      personas(),
      platforms()
    );
    expect(payload.brief).toEqual({ goal: "Launch", cta: "Sign up" });
  });

  it("resolves 'all in group' selection to a deduped union of persona ids", () => {
    const payload = buildCampaignPayload(
      {},
      personas({
        selectedPersonaIds: ["p1"],
        selectedGroups: [
          { id: "g1", persona_ids: ["p1", "p2"] },
          { id: "g2", persona_ids: ["p2", "p3"] },
        ],
      }),
      platforms()
    );
    // p1 (individual) + p1,p2 (g1) + p2,p3 (g2) → deduped union.
    expect([...payload.persona_ids].sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("falls back to the first persona when the resolved list is empty", () => {
    const payload = buildCampaignPayload(
      {},
      personas({ selectedPersonaIds: [], selectedGroups: [] }),
      platforms()
    );
    expect(payload.persona_ids).toEqual(["p1"]);
  });

  it("yields an empty persona list when there are no personas at all", () => {
    const payload = buildCampaignPayload(
      {},
      { selectedPersonaIds: [], selectedGroups: [], allPersonaIds: [] },
      platforms()
    );
    expect(payload.persona_ids).toEqual([]);
  });

  it("filters platforms to connected ∩ SUPPORTED_PLATFORMS", () => {
    // Selected x + an unsupported platform; only linkedin is connected.
    const payload = buildCampaignPayload(
      {},
      personas(),
      { selected: ["x", "linkedin", "facebook"], connected: ["linkedin"] }
    );
    expect(payload.platforms).toEqual(["linkedin"]);
  });

  it("omits platforms entirely when none survive the filter", () => {
    const payload = buildCampaignPayload(
      {},
      personas(),
      { selected: ["x"], connected: ["linkedin"] }
    );
    expect(payload).not.toHaveProperty("platforms");
  });

  it("caps media_asset_ids at 4", () => {
    const payload = buildCampaignPayload(
      { mediaAssetIds: ["a", "b", "c", "d", "e"] },
      personas(),
      platforms()
    );
    expect(payload.brief?.media_asset_ids).toEqual(["a", "b", "c", "d"]);
  });
});
