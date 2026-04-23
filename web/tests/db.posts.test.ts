import { describe, it, expectTypeOf } from "vitest";
import type { Database } from "@/lib/db/types";

type ContentItemRow = Database["public"]["Tables"]["content_items"]["Row"];
type ContentItemInsert = Database["public"]["Tables"]["content_items"]["Insert"];
type PostVariantRow = Database["public"]["Tables"]["post_variants"]["Row"];
type PostVariantInsert = Database["public"]["Tables"]["post_variants"]["Insert"];

describe("content_items types", () => {
  it("Row has expected columns", () => {
    expectTypeOf<ContentItemRow>().toHaveProperty("id");
    expectTypeOf<ContentItemRow>().toHaveProperty("workspace_id");
    expectTypeOf<ContentItemRow>().toHaveProperty("ingestion_job_id");
    expectTypeOf<ContentItemRow>().toHaveProperty("prompt_version_id");
    expectTypeOf<ContentItemRow>().toHaveProperty("summary");
    expectTypeOf<ContentItemRow>().toHaveProperty("created_at");
  });

  it("Insert type allows null for optional FK columns", () => {
    expectTypeOf<ContentItemInsert["ingestion_job_id"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<ContentItemInsert["prompt_version_id"]>().toEqualTypeOf<
      string | null | undefined
    >();
  });
});

describe("post_variants types", () => {
  it("Row has expected columns", () => {
    expectTypeOf<PostVariantRow>().toHaveProperty("id");
    expectTypeOf<PostVariantRow>().toHaveProperty("workspace_id");
    expectTypeOf<PostVariantRow>().toHaveProperty("content_item_id");
    expectTypeOf<PostVariantRow>().toHaveProperty("prompt_version_id");
    expectTypeOf<PostVariantRow>().toHaveProperty("platform");
    expectTypeOf<PostVariantRow>().toHaveProperty("body");
    expectTypeOf<PostVariantRow>().toHaveProperty("status");
    expectTypeOf<PostVariantRow>().toHaveProperty("scheduled_at");
    expectTypeOf<PostVariantRow>().toHaveProperty("created_at");
    expectTypeOf<PostVariantRow>().toHaveProperty("updated_at");
  });

  it("Insert type has body and platform as required-ish", () => {
    expectTypeOf<PostVariantInsert["body"]>().toEqualTypeOf<string>();
    expectTypeOf<PostVariantInsert["platform"]>().toEqualTypeOf<string>();
  });
});
