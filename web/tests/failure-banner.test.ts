import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FailureBanner } from "@/components/app/FailureBanner";
import type { TerminalFailure } from "@/lib/db/post-failures";

function render(failures: TerminalFailure[]): string {
  // FailureBanner is a pure Server Component (no hooks), so rendering it to
  // static markup exercises the real output tree.
  return renderToStaticMarkup(FailureBanner({ failures }));
}

const base: Omit<TerminalFailure, "platform" | "persona_name" | "campaign_id"> =
  {
    post_variant_id: "pv1",
    avatar_color: "#f00",
    error_code: "token_revoked",
  };

describe("FailureBanner", () => {
  it("renders nothing when the list is empty", () => {
    expect(FailureBanner({ failures: [] })).toBeNull();
    expect(render([])).toBe("");
  });

  it("renders the failure count and platform labels for non-empty input", () => {
    const failures: TerminalFailure[] = [
      { ...base, platform: "linkedin", persona_name: "Acme", campaign_id: "c1" },
      { ...base, post_variant_id: "pv2", platform: "x", persona_name: "Beta", campaign_id: "c1" },
    ];
    const html = render(failures);

    // Count of failing posts.
    expect(html).toContain("2 posts failed to publish");
    // Platform labels derived from SUPPORTED_PLATFORMS (linkedin, x).
    expect(html).toContain("LinkedIn");
    expect(html).toContain("X / Twitter");
    // Persona names in the summary.
    expect(html).toContain("Acme");
    expect(html).toContain("Beta");
  });

  it("uses the singular form for a single failure", () => {
    const html = render([
      { ...base, platform: "linkedin", persona_name: "Acme", campaign_id: "c1" },
    ]);
    expect(html).toContain("1 post failed to publish");
    expect(html).not.toContain("1 posts failed");
  });

  it("links to the failing campaign when a campaign_id is present", () => {
    const html = render([
      { ...base, platform: "linkedin", persona_name: "Acme", campaign_id: "c1" },
    ]);
    expect(html).toContain('href="/campaigns/c1"');
  });

  it("falls back to the queue link when no campaign is known", () => {
    const html = render([
      { ...base, platform: "x", persona_name: "Beta", campaign_id: null },
    ]);
    expect(html).toContain('href="/queue"');
  });
});
