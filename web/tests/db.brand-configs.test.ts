import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/db/types";

// Type-level tests — verify Phase 1 tables appear in the generated types
// and have the expected columns. No live Supabase connection required.

describe("brand_configs table types", () => {
  it("has expected columns", () => {
    type Row = Database["public"]["Tables"]["brand_configs"]["Row"];
    const row: Row = {
      workspace_id: "00000000-0000-0000-0000-000000000000",
      persona_id: "00000000-0000-0000-0000-000000000001",
      brand_name: "Acme Corp",
      industry: null,
      website_url: null,
      tone_tags: ["professional"],
      custom_system_prompt: null,
      current_prompt_version_id: null,
      voice_profile: null,
      voice_profile_updated_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(row.brand_name).toBe("Acme Corp");
    expect(Array.isArray(row.tone_tags)).toBe(true);
  });

  it("upsert type accepts partial nullable fields", () => {
    type Insert = Database["public"]["Tables"]["brand_configs"]["Insert"];
    const insert: Insert = {
      workspace_id: "00000000-0000-0000-0000-000000000000",
      persona_id: "00000000-0000-0000-0000-000000000001",
      brand_name: "Acme Corp",
      tone_tags: [],
    };
    expect(insert.brand_name).toBeDefined();
  });
});

describe("prompt_versions table types", () => {
  it("has expected columns", () => {
    type Row = Database["public"]["Tables"]["prompt_versions"]["Row"];
    const row: Row = {
      id: "00000000-0000-0000-0000-000000000000",
      workspace_id: "00000000-0000-0000-0000-000000000000",
      version_number: 1,
      system_prompt: "You are a helpful assistant.",
      created_by: "00000000-0000-0000-0000-000000000000",
      source: "manual",
      created_at: new Date().toISOString(),
    };
    expect(row.version_number).toBe(1);
    expect(row.system_prompt).toBeDefined();
  });
});

describe("social_connections table types", () => {
  it("has expected columns", () => {
    type Row = Database["public"]["Tables"]["social_connections"]["Row"];
    const row: Row = {
      id: "00000000-0000-0000-0000-000000000000",
      workspace_id: "00000000-0000-0000-0000-000000000000",
      persona_id: "00000000-0000-0000-0000-000000000001",
      platform: "linkedin",
      platform_user_id: null,
      platform_username: null,
      access_token_vault_id: null,
      refresh_token_vault_id: null,
      token_expires_at: null,
      needs_reauth: false,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(row.platform).toBe("linkedin");
    expect(row.needs_reauth).toBe(false);
  });
});
