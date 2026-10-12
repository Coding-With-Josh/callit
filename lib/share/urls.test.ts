import { describe, expect, it } from "vitest";
import { MARKET_ID_PATTERN } from "@/lib/panta/read-adapters";
import { absoluteUrl, SITE_URL } from "@/lib/seo/site";
import {
  blinkUrl,
  isShareableMarketId,
  marketUrl,
  SHARE_ID_PATTERN,
  SHARE_TEXT_MAX,
  shareText,
  telegramShareUrl,
  xIntentUrl,
} from "@/lib/share/urls";

const ID = "mkt-live-1";

describe("isShareableMarketId / pattern drift", () => {
  it("mirrors MARKET_ID_PATTERN so the server gate and share gate cannot drift", () => {
    expect(SHARE_ID_PATTERN.source).toBe(MARKET_ID_PATTERN.source);
    expect(SHARE_ID_PATTERN.flags).toBe(MARKET_ID_PATTERN.flags);
  });

  it("accepts slugs with letters, digits, dash and underscore", () => {
    expect(isShareableMarketId("mkt-live-1")).toBe(true);
    expect(isShareableMarketId("ABC_123-xyz")).toBe(true);
  });

  it("rejects out-of-scope ids (empty, whitespace, unicode, path chars, too long)", () => {
    for (const bad of [
      "",
      "a b",
      "../x",
      "/markets/x",
      "märket",
      "a".repeat(129),
      "a".repeat(0),
      "a?b",
    ]) {
      expect(isShareableMarketId(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("marketUrl / blinkUrl", () => {
  it("builds absolute canonical URLs with no origin drift", () => {
    expect(marketUrl(ID)).toBe(`${SITE_URL}/markets/${ID}`);
    expect(blinkUrl(ID)).toBe(`${SITE_URL}/blink/${ID}`);
    expect(marketUrl(ID)).toBe(absoluteUrl(`/markets/${ID}`));
  });

  it("returns null for an invalid id (fail closed)", () => {
    expect(marketUrl("")).toBeNull();
    expect(marketUrl("../x")).toBeNull();
    expect(blinkUrl("a b")).toBeNull();
  });
});

describe("shareText", () => {
  it("strips control characters (newline/param smuggling vector)", () => {
    const out = shareText("Cool market\nhttps://evil.example/x\t<phish>");
    expect(out).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(out).toContain("https://evil.example/x");
    expect(out).toContain("<phish>"); // angle brackets are fine: URL-encoded at use
  });

  it("collapses whitespace runs", () => {
    expect(shareText("  a \n\n b  c ")).toBe("a b c");
  });

  it("falls back to a static sentence for an empty title", () => {
    expect(shareText("")).toBe("A callit prediction market");
    expect(shareText("   ")).toBe("A callit prediction market");
  });

  it("caps length at a code-point boundary and never splits a surrogate pair", () => {
    const long = "🎉".repeat(SHARE_TEXT_MAX + 10);
    const out = shareText(long);
    expect(Array.from(out).length).toBeLessThanOrEqual(SHARE_TEXT_MAX);
    expect(out.endsWith("…")).toBe(true);
    // The replaced run is intact (check the last code point; `slice(-1)` would
    // grab a lone low-surrogate half — the whole point of the Array.from cap).
    expect([...out.replace("…", "")].pop()).toBe("🎉");
  });
});

describe("xIntentUrl — Phase 3 vectors", () => {
  it("keeps a crafted &url= inside the text param (no intent parameter injection)", () => {
    const evilTitle = "Cool market&url=https://evil.example/x";
    const href = xIntentUrl(ID, evilTitle);
    expect(href).not.toBeNull();
    const parsed = new URL(href!);
    expect(parsed.origin + parsed.pathname).toBe("https://twitter.com/intent/tweet");
    expect(parsed.searchParams.get("url")).toBe(`${SITE_URL}/markets/${ID}`);
    expect(parsed.searchParams.get("text")).toBe(shareText(evilTitle));
    expect(parsed.searchParams.get("text")).toContain("&url=https://evil.example/x");
    expect(parsed.href.includes("evil.example")).toBe(true); // but only as text
  });

  it("prefix-asserts the fixed host", () => {
    const href = xIntentUrl(ID, "t");
    expect(href?.startsWith("https://twitter.com/intent/tweet?")).toBe(true);
  });

  it("encodes url and text params", () => {
    const href = xIntentUrl(ID, "market #1? yay & more");
    const parsed = new URL(href!);
    expect(parsed.searchParams.get("url")).toBe(`${SITE_URL}/markets/${ID}`);
    expect(parsed.searchParams.get("text")).toBe("market #1? yay & more");
  });

  it("fails closed on lone surrogates (encodeURIComponent would throw)", () => {
    expect(xIntentUrl(ID, "bad \uD800 title")).toBeNull();
    expect(xIntentUrl(ID, "bad \uDC00 title")).toBeNull();
  });

  it("returns null for an invalid id", () => {
    expect(xIntentUrl("", "t")).toBeNull();
  });
});

describe("telegramShareUrl", () => {
  it("prefix-asserts the fixed host and keeps url/text params intact", () => {
    const href = telegramShareUrl(ID, "Cool market&url=https://evil.example/x");
    expect(href).not.toBeNull();
    const parsed = new URL(href!);
    expect(parsed.origin + parsed.pathname).toBe("https://t.me/share/url");
    expect(parsed.searchParams.get("url")).toBe(`${SITE_URL}/markets/${ID}`);
    expect(parsed.searchParams.get("text")).toContain("https://evil.example/x");
  });

  it("fails closed on lone surrogates and invalid ids", () => {
    expect(telegramShareUrl(ID, "\uD800")).toBeNull();
    expect(telegramShareUrl("", "t")).toBeNull();
  });
});

describe("boundary invariants", () => {
  it("market/blink URLs are absolute and on the canonical origin", () => {
    for (const url of [marketUrl(ID), blinkUrl(ID)]) {
      expect(url).not.toBeNull();
      expect(url!.startsWith("https://")).toBe(true);
      expect(url!.startsWith(SITE_URL)).toBe(true);
    }
  });

  it("intent URLs are absolute and pinned to their fixed hosts", () => {
    for (const url of [xIntentUrl(ID, "t"), telegramShareUrl(ID, "t")]) {
      expect(url).not.toBeNull();
      expect(url!.startsWith("https://")).toBe(true);
      expect(
        url!.startsWith("https://twitter.com/intent/tweet") ||
          url!.startsWith("https://t.me/share/url")
      ).toBe(true);
    }
  });

  it("share text stays bounded after encoding", () => {
    const text = xIntentUrl(ID, "x".repeat(1000));
    expect(decodeURIComponent(text!.split("&url=")[0].split("text=")[1]).length).toBeLessThanOrEqual(
      SHARE_TEXT_MAX
    );
  });
});