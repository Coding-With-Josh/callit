import { describe, expect, it } from "vitest";
import { templatedCoverDataUri } from "./create-image";

describe("templatedCoverDataUri", () => {
  it("returns an SVG data URI", () => {
    const uri = templatedCoverDataUri("Will Bitcoin close above $150,000?");
    expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(uri)).toContain("<svg");
  });

  it("XML-escapes untrusted question text (markup injection)", () => {
    const uri = templatedCoverDataUri('<script>alert(1)</script> "x" & y');
    const svg = decodeURIComponent(uri);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&amp;");
  });

  it("never throws on empty or whitespace input", () => {
    expect(templatedCoverDataUri("").startsWith("data:image/svg+xml,")).toBe(
      true,
    );
    expect(templatedCoverDataUri("   ").length).toBeGreaterThan(0);
  });
});