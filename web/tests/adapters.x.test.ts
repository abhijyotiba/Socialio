import { describe, it, expect } from "vitest";
import { buildAuthorizationUrl } from "@/lib/adapters/x";

// Set required env vars before importing the adapter
process.env.X_CLIENT_ID = "test-x-client-id";
process.env.X_REDIRECT_URI = "http://localhost:3000/api/oauth/x/callback";

describe("buildAuthorizationUrl", () => {
  it("returns an X authorization URL", () => {
    const url = buildAuthorizationUrl("test-state", "test-challenge");
    expect(url).toContain("https://twitter.com/i/oauth2/authorize");
  });

  it("includes required OAuth 2.0 PKCE params", () => {
    const url = buildAuthorizationUrl("state-abc", "challenge-xyz");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("test-x-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/oauth/x/callback"
    );
    expect(parsed.searchParams.get("state")).toBe("state-abc");
  });

  it("includes code_challenge and code_challenge_method=S256", () => {
    const url = buildAuthorizationUrl("s", "mychallenge");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("code_challenge")).toBe("mychallenge");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("requests the required scopes including offline.access", () => {
    const url = buildAuthorizationUrl("s", "c");
    const parsed = new URL(url);
    const scope = parsed.searchParams.get("scope") ?? "";
    expect(scope).toContain("tweet.write");
    expect(scope).toContain("users.read");
    expect(scope).toContain("offline.access");
  });

  it("different states produce different URLs", () => {
    const url1 = buildAuthorizationUrl("state-a", "challenge");
    const url2 = buildAuthorizationUrl("state-b", "challenge");
    expect(new URL(url1).searchParams.get("state")).toBe("state-a");
    expect(new URL(url2).searchParams.get("state")).toBe("state-b");
  });
});
