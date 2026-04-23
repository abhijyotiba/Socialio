import { describe, it, expectTypeOf } from "vitest";
import type { Database } from "@/lib/db/types";

type PublishAttemptRow =
  Database["public"]["Tables"]["publish_attempts"]["Row"];
type PublishAttemptInsert =
  Database["public"]["Tables"]["publish_attempts"]["Insert"];

describe("publish_attempts types", () => {
  it("Row has all expected columns", () => {
    expectTypeOf<PublishAttemptRow>().toHaveProperty("id");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("workspace_id");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("post_variant_id");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("idempotency_key");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("attempt_number");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("status");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("platform_post_id");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("platform_post_url");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("error_code");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("error_detail");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("attempted_at");
    expectTypeOf<PublishAttemptRow>().toHaveProperty("completed_at");
  });

  it("Insert allows nullable optional fields", () => {
    expectTypeOf<PublishAttemptInsert["platform_post_id"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<PublishAttemptInsert["platform_post_url"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<PublishAttemptInsert["error_code"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<PublishAttemptInsert["error_detail"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<PublishAttemptInsert["completed_at"]>().toEqualTypeOf<
      string | null | undefined
    >();
  });

  it("required insert fields are non-optional strings", () => {
    expectTypeOf<PublishAttemptInsert["idempotency_key"]>().toEqualTypeOf<string>();
    expectTypeOf<PublishAttemptInsert["post_variant_id"]>().toEqualTypeOf<string>();
    expectTypeOf<PublishAttemptInsert["workspace_id"]>().toEqualTypeOf<string>();
  });
});

describe("post_variants platform result columns (Phase 4 additions)", () => {
  type PostVariantRow = Database["public"]["Tables"]["post_variants"]["Row"];

  it("Row has platform_post_id, platform_post_url, error_code", () => {
    expectTypeOf<PostVariantRow>().toHaveProperty("platform_post_id");
    expectTypeOf<PostVariantRow>().toHaveProperty("platform_post_url");
    expectTypeOf<PostVariantRow>().toHaveProperty("error_code");
  });
});
