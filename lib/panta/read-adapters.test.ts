import { describe, it, expect } from 'vitest';
import { createPantaClient } from './client';
import { fetchCategories, fetchMarket, fetchMarketList } from './read-adapters';

const wireMarket = (overrides: Record<string, unknown> = {}) => ({
  marketId: 'mkt_1',
  category: 'crypto',
  title: 'Will BTC close above $150k?',
  description: 'desc',
  images: [],
  phase: 'primary',
  marketType: 'standard',
  startTime: 1788220800,
  endTime: 1798675200,
  resolutionTime: 1798761600,
  region: 'Global',
  resolved: false,
  status: 'primary',
  volumeUsdc: '84210.5',
  campaignId: null,
  createdByPartner: false,
  yesPrice: '0.62',
  noPrice: '0.38',
  primaryYesPrice: null,
  primaryNoPrice: null,
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
  it('maps categories to a plain array', async () => {
    const { client } = clientResponding({ categories: ['crypto', 'sports'] });
    const result = await fetchCategories(client);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(['crypto', 'sports']);
  });

  it('maps a market page to domain markets', async () => {
    const { client, calls } = clientResponding({
      items: [wireMarket()],
      nextCursor: null,
    });
    const result = await fetchMarketList(client, {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.markets[0]?.marketId).toBe('mkt_1');
      expect(result.value.markets[0]?.yesPrice).toBe('0.62');
      expect(result.value.nextCursor).toBeNull();
    }
    expect(calls[0]?.url).toBe(
      'https://live-api.panta.market/api/v1/markets/',
    );
  });

  it('fails the whole page when one item cannot be mapped', async () => {
    const { client } = clientResponding({
      items: [wireMarket(), wireMarket({ volumeUsdc: 'not-a-number' })],
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

  it('returns null for a 404 market', async () => {
    const { client, calls } = clientResponding(
      { code: 'MARKET_NOT_FOUND', message: 'nope' },
      404,
    );
    const result = await fetchMarket(client, 'mkt_1');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
    expect(calls[0]?.url).toBe(
      'https://live-api.panta.market/api/v1/markets/mkt_1/',
    );
  });

  it('maps a single market detail', async () => {
    const { client } = clientResponding(wireMarket({ phase: 'secondary' }));
    const result = await fetchMarket(client, 'mkt_1');
    expect(result.ok).toBe(true);
    if (result.ok && result.value) {
      expect(result.value.phase).toBe('secondary');
    }
  });
});
