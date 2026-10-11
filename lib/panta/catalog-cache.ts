/**
 * panta/catalog-cache — request-independent caching for the catalog reads behind
 * crawl-facing surfaces (metadata, OG images, sitemap.xml).
 *
 * Why this exists (Phase 2, degraded operation): the page/sitemap/OG routes all
 * need the same market read, and a crawler must not fan out to Panta on every
 * URL. Wrapping the read in `use cache` gives a cross-request last-good value
 * keyed by its arguments, so a short upstream blip is served from the previous
 * good read instead of collapsing a live URL into a 404 (deindex vector).
 *
 * Kept separate from catalog.ts so catalog.ts stays framework-free (its header
 * forbids importing Next).
 * Must not import: React components.
 */
import { cacheLife, cacheTag } from 'next/cache';
import type { MarketFixture } from '@/lib/market-fixtures';
import { loadMarket, loadMarketListing, type CatalogListing } from './catalog';

/** One cache tag covers the whole market surface; `market:<id>` is the narrow one. */
export const MARKET_CACHE_TAG = 'market-listing';

/**
 * The catalog listing, cached across requests. The cache key includes `limit`;
 * `nowAsOf()` runs inside the cached scope, so its timestamp is fixed once per
 * entry rather than re-evaluated per request.
 */
export async function loadMarketListingCached(
  limit = 24,
): Promise<CatalogListing> {
  'use cache';
  cacheLife('minutes');
  cacheTag(MARKET_CACHE_TAG);
  return loadMarketListing(limit);
}

/**
 * The market-detail read, cached across requests. Returns the same
 * `MarketFixture | null` shape as `loadMarket`, so callers keep their existing
 * null-handling (page -> notFound, OG -> generic card, metadata -> noindex).
 */
export async function loadMarketCached(
  id: string,
): Promise<MarketFixture | null> {
  'use cache';
  cacheLife('minutes');
  cacheTag(MARKET_CACHE_TAG, `market:${id}`);
  return loadMarket(id);
}
