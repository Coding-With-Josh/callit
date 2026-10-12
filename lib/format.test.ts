import { describe, expect, it } from "vitest";
import {
  asOfSchema,
  priceSchema,
  unixSecondsSchema,
  usdcDecimalSchema,
} from "@/types";
import {
  formatAsOf,
  formatUnixDate,
  formatUsdc,
  formatUsdcCompact,
  percentFromPrice,
} from "./format";

// Branded domain values must come from their zod schemas (types/money, time,
// compliance); parse the literals so the display formatters see valid brands.

describe("formatUsdc", () => {
  it("groups thousands and pads to two decimals", () => {
    expect(formatUsdc(usdcDecimalSchema.parse("84210.5"))).toBe("$84,210.50");
    expect(formatUsdc(usdcDecimalSchema.parse("0"))).toBe("$0.00");
  });

  it("truncates beyond two decimals without float rounding", () => {
    expect(formatUsdc(usdcDecimalSchema.parse("123456789.129"))).toBe(
      "$123,456,789.12",
    );
  });

  it("handles a whole-number string", () => {
    expect(formatUsdc(usdcDecimalSchema.parse("5"))).toBe("$5.00");
  });
});

describe("percentFromPrice", () => {
  it("shifts the decimal point two places right", () => {
    expect(percentFromPrice(priceSchema.parse("0.62"))).toBe("62");
    expect(percentFromPrice(priceSchema.parse("0.625"))).toBe("62.5");
    expect(percentFromPrice(priceSchema.parse("1"))).toBe("100");
    expect(percentFromPrice(priceSchema.parse("0.05"))).toBe("5");
  });

  it("truncates a long fractional percent so it can't overflow", () => {
    expect(percentFromPrice(priceSchema.parse("0.623456789"))).toBe("62.3");
    expect(percentFromPrice(priceSchema.parse("0.999999999"))).toBe("99.9");
  });

  it("honours an explicit fractional cap (and a cap of zero)", () => {
    expect(percentFromPrice(priceSchema.parse("0.6234"), 2)).toBe("62.34");
    expect(percentFromPrice(priceSchema.parse("0.6234"), 0)).toBe("62");
  });
});

describe("formatUsdcCompact", () => {
  it("defers to exact formatUsdc below 1,000", () => {
    expect(formatUsdcCompact(usdcDecimalSchema.parse("842.5"))).toBe("$842.50");
    expect(formatUsdcCompact(usdcDecimalSchema.parse("0"))).toBe("$0.00");
  });

  it("condenses thousands and millions, dropping a trailing .0", () => {
    expect(formatUsdcCompact(usdcDecimalSchema.parse("84210.5"))).toBe("$84.2K");
    expect(formatUsdcCompact(usdcDecimalSchema.parse("142000.25"))).toBe("$142K");
    expect(formatUsdcCompact(usdcDecimalSchema.parse("1234567.89"))).toBe("$1.2M");
  });

  it("condenses billions", () => {
    expect(formatUsdcCompact(usdcDecimalSchema.parse("3400000000"))).toBe("$3.4B");
  });
});

describe("formatAsOf", () => {
  it("renders UTC clock time", () => {
    expect(formatAsOf(asOfSchema.parse("2026-10-10T14:32:00Z"))).toBe(
      "14:32 UTC",
    );
  });
});

describe("formatUnixDate", () => {
  it("renders a UTC date string", () => {
    expect(formatUnixDate(unixSecondsSchema.parse(1760227200))).toBe(
      "Oct 12, 2025",
    );
  });
});