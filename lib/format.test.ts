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