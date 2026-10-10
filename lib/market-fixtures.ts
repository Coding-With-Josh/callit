/**
 * market-fixtures — preview markets for the hosted market-detail surface.
 *
 * NOT live data. Every read here carries provenance "fixture"; the UI renders
 * that label next to each price (types/compliance: fixtures never pass as
 * live). Replaced by GET /api/panta/markets/{id} once the proxy route exists
 * (see build.md backend checklist).
 *
 * Two fixtures exercise the two UI paths:
 *   - "demo-primary"     primary phase  -> buy panel structure
 *   - "demo-graduated"   secondary phase -> link-out card (graduated = read-only)
 */
import {
  asOf,
  marketId,
  priceSchema,
  unixSeconds,
  usdcDecimalSchema,
  type AsOf,
  type DataProvenance,
  type Market,
} from "@/types";

export interface MarketFixture {
  readonly market: Market;
  /** When this read was taken. Every displayed price must carry this. */
  readonly asOf: AsOf;
  readonly provenance: DataProvenance;
}

const READ_AS_OF = asOf("2026-10-10T12:00:00.000Z");
const PROVENANCE = "fixture" as const;

const FIXTURES: Record<string, MarketFixture> = {
  "demo-primary": {
    market: {
      marketId: marketId("demo-primary"),
      category: "Crypto",
      title: "Will Bitcoin close above $150,000 before Jan 1, 2027?",
      description:
        "BTC must close above $150,000 on a major exchange before the resolution deadline. Priced and settled by Panta.",
      phase: "primary",
      volumeUsdc: usdcDecimalSchema.parse("84210.5"),
      startTime: unixSeconds(1788220800),
      endTime: unixSeconds(1798675200),
      resolutionTime: unixSeconds(1798761600),
      resolved: false,
      yesPrice: priceSchema.parse("0.62"),
      noPrice: priceSchema.parse("0.38"),
    },
    asOf: READ_AS_OF,
    provenance: PROVENANCE,
  },
  "demo-graduated": {
    market: {
      marketId: marketId("demo-graduated"),
      category: "Politics",
      title: "Will the Senate confirm the nominee by Dec 31, 2026?",
      description:
        "Binary question on a confirmation vote. This market has graduated to secondary trading and is read-only here.",
      phase: "secondary",
      volumeUsdc: usdcDecimalSchema.parse("142000.25"),
      startTime: unixSeconds(1767225600),
      endTime: unixSeconds(1798675200),
      resolutionTime: unixSeconds(1798761600),
      resolved: false,
      yesPrice: priceSchema.parse("0.71"),
      noPrice: priceSchema.parse("0.29"),
    },
    asOf: READ_AS_OF,
    provenance: PROVENANCE,
  },
};

export function getMarketFixture(id: string): MarketFixture | null {
  // Exact-match lookup only — `id` is never used in a URL, query, or path
  // (Phase 1/3: injection + enumeration vector closed by construction).
  return FIXTURES[id] ?? null;
}

/**
 * Ids of the fixture markets. Used by the route's generateStaticParams while
 * fixtures stand in for the API (so unknown ids 404 at the routing layer).
 * Removed when the market detail fetch lands.
 */
export function listMarketFixtureIds(): string[] {
  return Object.keys(FIXTURES);
}