import { describe, it, expect } from "vitest";
import { mimeTypeFromUrl } from "@/lib/publish/upload-media";

describe("mimeTypeFromUrl", () => {
  it("returns image/jpeg for .jpg URLs", () => {
    expect(mimeTypeFromUrl("https://res.cloudinary.com/demo/image/upload/photo.jpg")).toBe("image/jpeg");
  });

  it("returns image/jpeg for .jpeg URLs", () => {
    expect(mimeTypeFromUrl("https://example.com/img.jpeg")).toBe("image/jpeg");
  });

  it("returns image/png for .png URLs", () => {
    expect(mimeTypeFromUrl("https://example.com/img.png")).toBe("image/png");
  });

  it("returns image/webp for .webp URLs", () => {
    expect(mimeTypeFromUrl("https://example.com/img.webp")).toBe("image/webp");
  });

  it("returns image/gif for .gif URLs", () => {
    expect(mimeTypeFromUrl("https://example.com/img.gif")).toBe("image/gif");
  });

  it("returns image/jpeg as fallback for unknown extension", () => {
    expect(mimeTypeFromUrl("https://example.com/img")).toBe("image/jpeg");
  });

  it("ignores query string when determining extension", () => {
    expect(mimeTypeFromUrl("https://example.com/img.png?v=1&size=large")).toBe("image/png");
  });
});
