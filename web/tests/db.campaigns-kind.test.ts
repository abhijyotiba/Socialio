import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/db/types";

describe("campaigns.kind type", () => {
  it("Row exposes kind", () => {
    type Row = Database["public"]["Tables"]["campaigns"]["Row"];
    const kind: Row["kind"] = "autopilot";
    expect(kind).toBe("autopilot");
  });
});
