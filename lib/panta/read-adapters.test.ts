import { describe, it, expect } from 'vitest';
import { createPantaClient } from './client';
import { fetchCategories, fetchMarket, fetchMarketList } from './read-adapters';

/**
 * Mirrors the *live* pk_test shape: market times are ISO-8601 strings and the
 * response carries a sandbox `disclaimer` (see the live checkpoint). A separate
 * test covers the docs' unix-int form.
 */
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

function clientResponding(body: unknown, status = 200) {
  const calls: Array<{ url: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push({ url: String(input) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  const client = createPantaClient({
    apiKey: 'pk_test_secret',
    baseUrl: 'https://live-api.panta.market/api/v1',
    fetchImpl,
  });
  return { client, calls };
}

describe('read adapters', () => {
  it('maps categories to a plain array and threads the disclaimer', async () => {
    const { client } = clientResponding({
      categories: ['crypto', 'sports'],
      disclaimer: 'Test mode',
    });
    const result = await fetchCategories(client);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.categories).toEqual(['crypto', 'sports']);
      expect(result.value.disclaimer).toBe('Test mode');
    }
  });

  it('parses an ISO market time into unix seconds (live shape)', async () => {
    const { client, calls } = clientResponding({
      items: [wireMarket()],
      nextCursor: null,
      disclaimer: 'Test mode',
    });
    const result = await fetchMarketList(client, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.markets[0]?.marketId).toBe('mkt_1');
      expect(result.value.markets[0]?.yesPrice).toBe('0.62');
      expect(result.value.markets[0]?.startTime).toBe(1767225600);
      expect(result.value.nextCursor).toBeNull();
      expect(result.value.disclaimer).toBe('Test mode');
    }
    expect(calls[0]?.url).toBe(
      'https://live-api.panta.market/api/v1/markets/',
    );
  });

  it('also accepts a unix-int market time (docs shape)', async () => {
    const { client } = clientResponding({
      items: [wireMarket({ startTime: 1767225600 })],
    });
    const result = await fetchMarketList(client, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.markets[0]?.startTime).toBe(1767225600);
  });

  it('fails the whole page when one item cannot be mapped', async () => {
    const { client } = clientResponding({
      items: [wireMarket(), wireMarket({ volumeUsdc: 'not-a-number' })],
    });
    const result = await fetchMarketList(client, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('malformed');
  });

  it('fails closed on an unparseable time instead of coercing to zero', async () => {
    const { client } = clientResponding({
      items: [wireMarket({ startTime: 'not-a-time' })],
    });
    const result = await fetchMarketList(client, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('malformed');
  });

  it('degrades an out-of-range price to null instead of trusting it', async () => {
    const { client } = clientResponding({
      items: [wireMarket({ yesPrice: '1.5' })],
    });
    const result = await fetchMarketList(client, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.markets[0]?.yesPrice).toBeNull();
  });

  it('accepts a null detail volumeUsdc instead of failing the whole read', async () => {
    // Regression: the live detail endpoint returns `volumeUsdc: null` for the same
    // market the list fills. Asserting a string here made every detail read fail
    // and the page render "Market not found".
    const { client } = clientResponding(wireMarket({ volumeUsdc: null }));
    const result = await fetchMarket(client, 'mkt_1');
    expect(result.ok).toBe(true);
    if (result.ok && result.value.market) {
      expect(result.value.market.volumeUsdc).toBe('0');
    }
  });

  it('returns a null market for a 404', async () => {
    const { client, calls } = clientResponding(
      { code: 'MARKET_NOT_FOUND', message: 'nope' },
      404,
    );
    const result = await fetchMarket(client, 'mkt_1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.market).toBeNull();
      expect(result.value.disclaimer).toBeNull();
    }
    expect(calls[0]?.url).toBe(
      'https://live-api.panta.market/api/v1/markets/mkt_1/',
    );
  });

  it('maps a single market detail and passes the disclaimer through', async () => {
    const { client } = clientResponding(
      wireMarket({
        phase: 'secondary',
        disclaimer: 'Test mode: sandbox fixtures',
      }),
    );
    const result = await fetchMarket(client, 'mkt_1');
    expect(result.ok).toBe(true);
    if (result.ok && result.value.market) {
      expect(result.value.market.phase).toBe('secondary');
      expect(result.value.disclaimer).toBe('Test mode: sandbox fixtures');
    }
  });
});
