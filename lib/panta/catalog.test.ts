import { describe, it, expect } from 'vitest';
import { ok, err } from '@/types';
import { createPantaClient } from './client';
import { loadMarket, loadMarketListing, type PantaClientProvider } from './catalog';

const wireMarket = (overrides: Record<string, unknown> = {}) => ({
  marketId: 'mkt_1',
  category: 'crypto',
  title: 'Will BTC close above $150k?',
  description: 'desc',
  images: [],
  phase: 'primary',
  marketType: 'standard',
  startTime: '2026-01-01T00:00:00Z',
  endTime: '2026-12-31T23:59:59Z',
  resolutionTime: '2027-01-01T00:00:00Z',
  region: 'Global',
  resolved: false,
  status: 'primary',
  volumeUsdc: '84210.5',
  campaignId: null,
  createdByPartner: false,
  yesPrice: '0.62',
  noPrice: '0.38',
  primaryYesPrice: '0.62',
  primaryNoPrice: '0.38',
  secondaryYesPrice: null,
  secondaryNoPrice: null,
  ...overrides,
});

/** A provider whose client always answers with `body` at `status`. */
function providerResponding(body: unknown, status = 200): PantaClientProvider {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  return () =>
    ok(
      createPantaClient({
        apiKey: 'pk_test_secret',
        baseUrl: 'https://live-api.panta.market/api/v1',
        fetchImpl,
      }),
    );
}

const noKey: PantaClientProvider = () =>
  err({ kind: 'config', message: 'PANTA_API_KEY is not set' });

/**
 * The lean upstream variant: the same row with every price (and volume) null.
 * Panta serves this when its RPC-backed price read does not succeed.
 */
const leanWireMarket = () =>
  wireMarket({
    yesPrice: null,
    noPrice: null,
    primaryYesPrice: null,
    primaryNoPrice: null,
    volumeUsdc: null,
  });

/** A provider that answers with each step in turn, and counts the calls made. */
function providerSequence(
  steps: readonly { body: unknown; status?: number }[],
): { provider: PantaClientProvider; calls: () => number } {
  let index = 0;
  let count = 0;
  const fetchImpl = (async () => {
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    count += 1;
    return new Response(JSON.stringify(step?.body ?? {}), {
      status: step?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const provider: PantaClientProvider = () =>
    ok(
      createPantaClient({
        apiKey: 'pk_test_secret',
        baseUrl: 'https://live-api.panta.market/api/v1',
        fetchImpl,
      }),
    );
  return { provider, calls: () => count };
}

const listingBody = (items: unknown[]) => ({ items, nextCursor: null });

describe('catalog loader', () => {
  it('falls back to labeled fixtures when there is no key', async () => {
    const listing = await loadMarketListing(24, noKey);
    expect(listing.provenance).toBe('fixture');
    expect(listing.disclaimer).toBeNull();
    expect(listing.items.length).toBeGreaterThan(0);
    for (const item of listing.items) expect(item.provenance).toBe('fixture');
  });

  it('returns live items with a read-time asOf and the sandbox disclaimer', async () => {
    const listing = await loadMarketListing(
      24,
      providerResponding({
        items: [wireMarket()],
        nextCursor: null,
        disclaimer: 'Test mode',
      }),
    );
    expect(listing.provenance).toBe('live');
    expect(listing.disclaimer).toBe('Test mode');
    expect(listing.items[0]?.market.marketId).toBe('mkt_1');
    expect(listing.items[0]?.provenance).toBe('live');
    expect(listing.items[0]?.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('honors an empty live catalog (no fixture substitution)', async () => {
    const listing = await loadMarketListing(
      24,
      providerResponding({ items: [] }),
    );
    expect(listing.provenance).toBe('live');
    expect(listing.items).toEqual([]);
  });

  it('degrades to fixtures on an upstream failure', async () => {
    const listing = await loadMarketListing(
      24,
      providerResponding({ code: 'INTERNAL_ERROR', message: 'boom' }, 500),
    );
    expect(listing.provenance).toBe('fixture');
  });

  it('degrades to fixtures when the client provider itself throws', async () => {
    const throwing: PantaClientProvider = () => {
      throw new Error('boom');
    };
    const listing = await loadMarketListing(24, throwing);
    expect(listing.provenance).toBe('fixture');
  });

  it('returns a live market detail', async () => {
    const market = await loadMarket(
      'mkt_1',
      providerResponding(wireMarket({ disclaimer: 'Test mode' })),
    );
    expect(market?.provenance).toBe('live');
    expect(market?.market.marketId).toBe('mkt_1');
    expect(market?.disclaimer).toBe('Test mode');
  });

  it('falls back to a known fixture id when the live read 404s', async () => {
    const market = await loadMarket(
      'demo-primary',
      providerResponding({ code: 'MARKET_NOT_FOUND', message: 'nope' }, 404),
    );
    expect(market?.provenance).toBe('fixture');
    expect(market?.market.marketId).toBe('demo-primary');
  });

  it('resolves an unknown, non-fixture id to null (-> notFound)', async () => {
    const market = await loadMarket(
      'totally-unknown',
      providerResponding({ code: 'MARKET_NOT_FOUND', message: 'nope' }, 404),
    );
    expect(market).toBeNull();
  });

  it('never sends a non-slug id upstream (path-injection guard)', async () => {
    let networkCalled = false;
    const provider: PantaClientProvider = () =>
      ok(
        createPantaClient({
          apiKey: 'k',
          baseUrl: 'https://live-api.panta.market/api/v1',
          fetchImpl: (async () => {
            networkCalled = true;
            return new Response('{}');
          }) as unknown as typeof fetch,
        }),
      );
    const market = await loadMarket('../etc', provider);
    expect(market).toBeNull();
    // fetchMarket rejects the id before any network call (Phase 3: path
    // injection) — the injected fetch is never reached.
    expect(networkCalled).toBe(false);
  });

  it('re-reads a page whose rows all lack odds and returns the priced read', async () => {
    // Regression: Panta serves the same rows with every price null when its RPC
    // read fails, which rendered a Browse column of bare placeholders.
    const { provider, calls } = providerSequence([
      { body: listingBody([leanWireMarket()]) },
      { body: listingBody([wireMarket()]) },
    ]);
    const listing = await loadMarketListing(24, provider);
    expect(listing.provenance).toBe('live');
    expect(listing.items[0]?.market.yesPrice).toBe('0.62');
    expect(calls()).toBe(2);
  });

  it('stops re-reading at the bound and keeps the price-less live page', async () => {
    const { provider, calls } = providerSequence([
      { body: listingBody([leanWireMarket()]) },
    ]);
    const listing = await loadMarketListing(24, provider);
    // Never fixtures, never a fabricated price: the truthful upstream payload.
    expect(listing.provenance).toBe('live');
    expect(listing.items[0]?.market.yesPrice).toBeNull();
    expect(calls()).toBe(6);
  });

  it('does not re-read a genuinely empty catalog', async () => {
    const { provider, calls } = providerSequence([{ body: listingBody([]) }]);
    const listing = await loadMarketListing(24, provider);
    expect(listing.items).toEqual([]);
    expect(calls()).toBe(1);
  });

  it('does not re-read after an upstream error (no retry amplification)', async () => {
    const { provider, calls } = providerSequence([
      { body: { code: 'INTERNAL_ERROR', message: 'boom' }, status: 500 },
      { body: listingBody([wireMarket()]) },
    ]);
    const listing = await loadMarketListing(24, provider);
    expect(listing.provenance).toBe('fixture');
    expect(calls()).toBe(1);
  });

  it('re-reads an unpriced market detail', async () => {
    const { provider, calls } = providerSequence([
      { body: leanWireMarket() },
      { body: wireMarket() },
    ]);
    const market = await loadMarket('mkt_1', provider);
    expect(market?.provenance).toBe('live');
    expect(market?.market.yesPrice).toBe('0.62');
    expect(calls()).toBe(2);
  });

  it('does not re-read a 404 detail (nothing to price)', async () => {
    const { provider, calls } = providerSequence([
      { body: { code: 'MARKET_NOT_FOUND', message: 'nope' }, status: 404 },
    ]);
    const market = await loadMarket('demo-primary', provider);
    expect(market?.provenance).toBe('fixture');
    expect(calls()).toBe(1);
  });
});
