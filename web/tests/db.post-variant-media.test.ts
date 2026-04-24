import { describe, it, expectTypeOf } from "vitest";
import type { Database } from "@/lib/db/types";

type Row = Database["public"]["Tables"]["post_variant_media"]["Row"];

describe("post_variant_media types", () => {
  it("Row has expected columns", () => {
    expectTypeOf<Row>().toHaveProperty("post_variant_id");
    expectTypeOf<Row>().toHaveProperty("media_asset_id");
    expectTypeOf<Row>().toHaveProperty("position");
  });

  it("post_variant_id and media_asset_id are strings (UUIDs)", () => {
    expectTypeOf<Row["post_variant_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["media_asset_id"]>().toEqualTypeOf<string>();
  });

  it("position is a number", () => {
    expectTypeOf<Row["position"]>().toEqualTypeOf<number>();
  });
});
