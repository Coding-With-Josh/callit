import { describe, expect, it } from "vitest";
import {
  previewCardDataUri,
  previewCardSlotsForMarket,
  templatedCoverDataUri,
} from "./create-image";
import type { Market } from "@/types";

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

  // Regression: an <img>-loaded SVG is an isolated document that cannot see the
  // page's webfonts, so the Tusker face has to ride inside the SVG itself.
  it("inlines the supplied @font-face into the SVG", () => {
    const face =
      "@font-face{font-family:CoverTusker;src:url(data:font/ttf;base64,AAAA) format('truetype');}";
    const svg = decodeURIComponent(
      templatedCoverDataUri("Will Bitcoin close above $150k?", face),
    );
    expect(svg).toContain("@font-face");
    expect(svg).toContain("font-family:CoverTusker");
    expect(svg).toContain("data:font/ttf;base64,AAAA");
  });

  it("omits @font-face and keeps the system fallback when none is supplied", () => {
    const svg = decodeURIComponent(templatedCoverDataUri("Will BTC close?"));
    expect(svg).not.toContain("@font-face");
    // The family stack must always carry the fallback, so a missing embed still
    // renders rather than yielding blank text.
    expect(svg).toContain("CoverTusker, system-ui, sans-serif");
  });
});

describe("previewCardDataUri", () => {
  it("renders the live-market slots into the footer", () => {
    const svg = decodeURIComponent(
      previewCardDataUri({
        headline: "Will Bitcoin close above $150,000 by 2026?",
        phase: "live",
        price: "$0.03",
      }),
    );
    expect(svg).toContain("callit · live · $0.03");
    expect(svg).toContain("Will Bitcoin");
  });

  it("draft mode renders the template placeholders verbatim", () => {
    const svg = decodeURIComponent(templatedCoverDataUri("Will BTC close?"));
    expect(svg).toContain("callit · [phase] · $[price]");
  });

  it("XML-escapes every slot, including phase and price (defense in depth)", () => {
    const svg = decodeURIComponent(
      previewCardDataUri({
        headline: "<script>alert(1)</script>",
        phase: '<img src=x onerror=1>',
        price: '" & \'',
      }),
    );
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<img");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&lt;img");
    expect(svg).toContain("&quot; &amp; &apos;");
  });

  it("includes the static decoration layers at their design positions", () => {
    const svg = decodeURIComponent(
      previewCardDataUri({ headline: "x", phase: "live", price: "$0.03" }),
    );
    // Smiley doodle (bottom-left) and chat-bubble doodle with the baked-in
    // "Yes or No" text (top-right), both at 10% opacity, from the exports.
    expect(svg).toContain('opacity="0.1"');
    expect(svg).toContain("M82.517 156.708");
    expect(svg).toContain("M273.47 56.8948");
    expect(svg).toContain('transform="translate(9.994 314.001)"');
    expect(svg).toContain('transform="translate(753 0)"');
  });

  it("is deterministic: identical slots yield identical art", () => {
    const slots = { headline: "Same claim", phase: "live", price: "$0.03" };
    expect(previewCardDataUri(slots)).toBe(previewCardDataUri(slots));
  });
});

describe("previewCardSlotsForMarket", () => {
  it("maps a primary market's phase and yes-price onto the card slots", () => {
    const market = {
      phase: "primary",
      title: "Will X?",
      yesPrice: "0.03",
      noPrice: "0.97",
    } as unknown as Market;
    expect(previewCardSlotsForMarket(market)).toEqual({
      headline: "Will X?",
      phase: "live",
      price: "$0.03",
    });
  });

  it("renders an honest placeholder when the market has no fillable price", () => {
    const market = {
      phase: "resolved",
      title: "Was X?",
      yesPrice: null,
      noPrice: null,
    } as unknown as Market;
    expect(previewCardSlotsForMarket(market)).toEqual({
      headline: "Was X?",
      phase: "resolved",
      price: "$—",
    });
  });

  it("labels a settled market as resolved even when the wire phase flaps", () => {
    // Panta's phase string alternates between "resolved" and "secondary" for the
    // same settled market between reads. The shared card image must not bake a
    // different word in on each read.
    for (const phase of ["resolved", "secondary"] as const) {
      const market = {
        phase,
        resolved: true,
        title: "Was X?",
        yesPrice: "0.03",
        noPrice: "0.97",
      } as unknown as Market;
      expect(previewCardSlotsForMarket(market).phase).toBe("resolved");
    }
  });
});