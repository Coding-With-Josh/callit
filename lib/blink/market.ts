/**
 * blink/market — resolving a Blink's market id, bounded.
 *
 * Owns: the single entry point that turns an untrusted `marketId` path segment
 * into a `MarketFixture`, and the catalog-membership gate that bounds how much
 * upstream work that can ever cost.
 * Must not import: React, Next, or any UI module.
 *
 * Why the membership gate exists (Phase 3, found in review): the Blink metadata
 * route is unauthenticated and public, and `loadMarketCached(id)` keys its `use
 * cache` entry on the id — so every DISTINCT id is a distinct cache entry, and a
 * miss falls through `loadMarket` to a real `GET /markets/{id}/` on Panta. An
 * attacker iterating random ids therefore converts a stream of 404s into a
 * stream of Panta reads and can exhaust the read budget the whole site shares
 * (the site then degrades to fixture data everywhere). No per-IP limiter fixes
 * that: the amplification is per distinct id, not per IP.
 *
 * The gate closes it by requiring the id to be in the catalog listing we already
 * cache under a FIXED limit, i.e. one cache key. Then:
 *   - an id that is not in the listing costs ZERO upstream reads (404 locally),
 *   - the set of ids that can reach a detail read is bounded by the listing size,
 *   - the enumeration attack has no amplification left to exploit.
 *
 * Cost, stated plainly: a market absent from the listing has no working Blink.
 * Its `/markets/[id]` page still renders, so this is a distribution-surface
 * limit, not a data-visibility one. `BLINK_CATALOG_LIMIT` is a single constant
 * precisely so widening it (or replacing this resolver with a local market
 * table) is a one-line change.
 */
import { loadMarketCached, loadMarketListingCached } from '@/lib/panta/catalog-cache';
import type { MarketFixture } from '@/lib/market-fixtures';

/**
 * The catalog page a Blink-able market must appear on.
 *
 * Fixed (not a parameter and not caller-supplied) so this stays ONE cache entry:
 * if the limit varied per request, an attacker could vary it and reintroduce a
 * cache key per request, which is the amplification this module exists to stop.
 */
export const BLINK_CATALOG_LIMIT = 50;

/**
 * Resolve an untrusted market id to its fixture, or null.
 *
 * Null means "no Blink here", and it is returned without any Panta call for an
 * id outside the listing. The id itself has already passed `MARKET_ID_PATTERN`
 * at the route perimeter; the comparison below is exact string equality, so a
 * near-miss id can never be coerced into a listed one.
 */
export async function loadBlinkMarket(
  marketId: string,
): Promise<MarketFixture | null> {
  const listing = await loadMarketListingCached(BLINK_CATALOG_LIMIT);
  const listed = listing.items.some((item) => item.market.marketId === marketId);
  if (!listed) return null;
  return loadMarketCached(marketId);
}
