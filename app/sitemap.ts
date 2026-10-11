import type { MetadataRoute } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { absoluteUrl } from '@/lib/seo/site';
import {
  MARKET_CACHE_TAG,
  loadMarketListingCached,
} from '@/lib/panta/catalog-cache';

/**
 * sitemap.xml — the canonical, indexable URL set.
 *
 * Phase 3 (sitemap enumeration):
 * - Fixture/demo ids are NEVER emitted: `loadMarketListingCached()` returns
 *   `provenance: "fixture"` when the live read fails, and market URLs are
 *   emitted only for a live, non-sandbox listing. A demo id must not be
 *   advertised as a real market, and a degraded (fixture) listing advertises
 *   zero markets rather than the wrong ones.
 * - Sandbox (pk_test) listings are excluded for the same reason their pages are
 *   noindexed: a URL must never be listed here and forbidden in its own page.
 * - Only tradable phases are emitted; resolved/cancelled URLs are dropped.
 *
 * Determinism (Phase 2): the whole document — including `lastModified` — is
 * built inside a `use cache` scope, so `new Date()` is evaluated once per cache
 * entry instead of once per request (a per-request "now" would make the file
 * dynamic and destabilise `lastmod`).
 */
async function buildSitemap(): Promise<MetadataRoute.Sitemap> {
  'use cache';
  cacheLife('minutes');
  cacheTag(MARKET_CACHE_TAG);

  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl('/'),
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: absoluteUrl('/create'),
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  const listing = await loadMarketListingCached();

  // Phase 3 (sitemap/robots contradiction): a sandbox listing (Panta's pk_test
  // "Test mode" disclaimer) is indexed nowhere — its pages are emitted noindex
  // by app/markets/[id]/page.tsx. Advertising its URLs here would send a
  // contradictory signal (listed in the sitemap, forbidden in the page), so
  // market URLs are emitted only for a live, non-sandbox listing.
  const indexable =
    listing.provenance === 'live' && listing.disclaimer === null;

  const marketRoutes: MetadataRoute.Sitemap =
    indexable
      ? listing.items
          .filter(
            (item) =>
              item.market.phase === 'primary' ||
              item.market.phase === 'secondary',
          )
          .map((item) => ({
            url: absoluteUrl(`/markets/${item.market.marketId}`),
            lastModified: now,
            changeFrequency: 'hourly',
            priority: 0.8,
          }))
      : [];

  return [...staticRoutes, ...marketRoutes];
}

export default function sitemap(): Promise<MetadataRoute.Sitemap> {
  return buildSitemap();
}
