import { describe, it, expect } from "vitest";
import { parseInput } from "@/lib/chat/parse-input";

describe("parseInput()", () => {
  it("returns null url and full text as angle when no URL present", () => {
    expect(parseInput("Why AI startups fold")).toEqual({
      url: null,
      angle: "Why AI startups fold",
    });
  });

  it("extracts the first URL and treats the remainder as the angle", () => {
    expect(parseInput("https://x.com/a make it skeptical")).toEqual({
      url: "https://x.com/a",
      angle: "make it skeptical",
    });
  });

  it("returns empty angle for a bare URL", () => {
    expect(parseInput("https://x.com/a")).toEqual({
      url: "https://x.com/a",
      angle: "",
    });
  });

  it("trims surrounding whitespace from the angle", () => {
    expect(parseInput("  topic only  ")).toEqual({
      url: null,
      angle: "topic only",
    });
  });
});
