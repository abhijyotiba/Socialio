import { describe, it, expect } from "vitest";
import { buildAuthorizationUrl, buildLinkedInPostBody } from "@/lib/adapters/linkedin";

// Set required env vars for tests that build URLs
process.env.LINKEDIN_CLIENT_ID = "test-client-id";
process.env.LINKEDIN_REDIRECT_URI = "http://localhost:3000/api/oauth/linkedin/callback";

describe("buildAuthorizationUrl", () => {
  it("returns a LinkedIn authorization URL", () => {
    const url = buildAuthorizationUrl("test-state-123");
    expect(url).toContain("https://www.linkedin.com/oauth/v2/authorization");
  });

  it("includes required OAuth params", () => {
    const url = buildAuthorizationUrl("abc");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("test-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/oauth/linkedin/callback"
    );
    expect(parsed.searchParams.get("state")).toBe("abc");
  });

  it("requests the expected scopes", () => {
    const url = buildAuthorizationUrl("xyz");
    const parsed = new URL(url);
    const scope = parsed.searchParams.get("scope") ?? "";
    expect(scope).toContain("openid");
    expect(scope).toContain("profile");
    expect(scope).toContain("email");
    // w_member_social added in Phase 4 (requires LinkedIn partner approval)
  });

  it("includes different states for different calls", () => {
    const url1 = buildAuthorizationUrl("state-a");
    const url2 = buildAuthorizationUrl("state-b");
    expect(new URL(url1).searchParams.get("state")).toBe("state-a");
    expect(new URL(url2).searchParams.get("state")).toBe("state-b");
  });
});

describe("buildLinkedInPostBody", () => {
  it("sets shareMediaCategory to NONE when no mediaUrns provided", () => {
    const body = buildLinkedInPostBody("urn:li:person:123", "Hello world", undefined);
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory).toBe("NONE");
    expect((body.specificContent["com.linkedin.ugc.ShareContent"] as Record<string, unknown>).media).toBeUndefined();
  });

  it("sets shareMediaCategory to IMAGE and includes media array when urns provided", () => {
    const body = buildLinkedInPostBody("urn:li:person:123", "Hello world", [
      "urn:li:digitalmediaAsset:ABC",
      "urn:li:digitalmediaAsset:DEF",
    ]);
    const content = body.specificContent["com.linkedin.ugc.ShareContent"] as Record<string, unknown>;
    expect(content.shareMediaCategory).toBe("IMAGE");
    const media = content.media as Array<{ status: string; media: string }>;
    expect(media).toHaveLength(2);
    expect(media[0].media).toBe("urn:li:digitalmediaAsset:ABC");
    expect(media[1].media).toBe("urn:li:digitalmediaAsset:DEF");
  });
});
