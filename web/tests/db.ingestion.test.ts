import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/db/types";

// Type-level tests — verify Phase 2 tables appear in the generated types
// and have the expected columns. No live Supabase connection required.

describe("ingestion_jobs table types", () => {
  it("Row has all expected columns", () => {
    type Row = Database["public"]["Tables"]["ingestion_jobs"]["Row"];
    const row: Row = {
      id: "00000000-0000-0000-0000-000000000000",
      workspace_id: "00000000-0000-0000-0000-000000000000",
      source_type: "url",
      source_url: "https://example.com",
      source_text: null,
      extracted_title: null,
      extracted_text: null,
      stage: "pending",
      error: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    expect(row.stage).toBe("pending");
    expect(row.source_type).toBe("url");
  });

  it("Insert type allows optional id and timestamps", () => {
    type Insert = Database["public"]["Tables"]["ingestion_jobs"]["Insert"];
    const insert: Insert = {
      workspace_id: "00000000-0000-0000-0000-000000000000",
      source_type: "text",
      source_text: "Hello world",
    };
    expect(insert.source_type).toBe("text");
    // id, created_at, stage are all optional in Insert
    expect(insert.id).toBeUndefined();
  });

  it("Update type allows partial patch", () => {
    type Update = Database["public"]["Tables"]["ingestion_jobs"]["Update"];
    const patch: Update = {
      stage: "done",
      extracted_title: "Article Title",
      completed_at: new Date().toISOString(),
    };
    expect(patch.stage).toBe("done");
  });
});

describe("media_assets table types", () => {
  it("Row has all expected columns", () => {
    type Row = Database["public"]["Tables"]["media_assets"]["Row"];
    const row: Row = {
      id: "00000000-0000-0000-0000-000000000000",
      workspace_id: "00000000-0000-0000-0000-000000000000",
      ingestion_job_id: "00000000-0000-0000-0000-000000000001",
      cloudinary_url: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      cloudinary_id: "socialos/ws123/sample",
      resource_type: "image",
      format: "jpg",
      bytes: 102400,
      width: 1200,
      height: 630,
      created_at: new Date().toISOString(),
    };
    expect(row.resource_type).toBe("image");
    expect(row.cloudinary_id).toBeDefined();
  });

  it("Insert type requires cloudinary_url, cloudinary_id, resource_type", () => {
    type Insert = Database["public"]["Tables"]["media_assets"]["Insert"];
    const insert: Insert = {
      workspace_id: "00000000-0000-0000-0000-000000000000",
      cloudinary_url: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      cloudinary_id: "socialos/ws123/sample",
      resource_type: "image",
    };
    expect(insert.cloudinary_url).toBeDefined();
    // Nullable fields are optional in Insert
    expect(insert.bytes).toBeUndefined();
    expect(insert.width).toBeUndefined();
  });

  it("ingestion_job_id is nullable", () => {
    type Row = Database["public"]["Tables"]["media_assets"]["Row"];
    const row: Row = {
      id: "00000000-0000-0000-0000-000000000000",
      workspace_id: "00000000-0000-0000-0000-000000000000",
      ingestion_job_id: null,
      cloudinary_url: "https://res.cloudinary.com/demo/image/upload/sample.jpg",
      cloudinary_id: "socialos/ws123/sample",
      resource_type: "video",
      format: null,
      bytes: null,
      width: null,
      height: null,
      created_at: new Date().toISOString(),
    };
    expect(row.ingestion_job_id).toBeNull();
  });
});
