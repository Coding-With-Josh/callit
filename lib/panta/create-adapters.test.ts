import { describe, it, expect } from 'vitest';
import { createPantaClient, PantaCallError } from './client';
import {
  buildCreateTransaction,
  createPantaCreateAdapters,
  requestCreateQuote,
  type CreateQuoteDraftInput,
} from './create-adapters';
import { txSignature, unixSeconds, type ResolvableDraft } from '@/types';

const EVENT_PDA = '11111111111111111111111111111111';
const WALLET = 'Creator1111111111111111111111111111111';

const draft: ResolvableDraft = {
  question: 'Will ETH be above $5,000 on 2027-01-01?',
  resolutionRule:
    'Resolves to YES if CoinGecko daily close UTC on 2027-01-01 is above $5,000.',
  sourcesOfTruth: ['https://www.coingecko.com'],
  category: 'crypto',
  startTime: 1893456000,
  endTime: 1896127200,
  resolutionTime: 1896130800,
  marketType: 'standard',
  eventInProgress: false,
  injection: { suspicious: false, reasons: [] },
  validated: true,
  resolvable: true,
  resolvability: { resolvable: true, reasons: [], suggestions: [] },
};

function routingClient(
  routes: Record<string, { status?: number; body: unknown }>,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes).find((p) => url.includes(p));
    const route = key ? routes[key] : undefined;
    return new Response(JSON.stringify(route?.body ?? { code: 'X', message: 'no route' }), {
      status: route ? (route.status ?? 200) : 404,
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

function adapters(client: ReturnType<typeof routingClient>['client']) {
  return createPantaCreateAdapters({
    client,
    wallet: WALLET,
    generateDraft: async () => {
      throw new Error('generateDraft not under test');
    },
    uploadImage: async () => 'https://cdn.example.com/cover.png',
    signCreate: async () => txSignature('1'.repeat(88)),
    now: () => unixSeconds(1_700_000_000),
  });
}

describe('create adapters', () => {
  it('returns the category slugs', async () => {
    const { client } = routingClient({
      '/categories/': { body: { categories: ['crypto', 'sports'] } },
    });
    expect(await adapters(client).fetchCategories()).toEqual(['crypto', 'sports']);
  });

  it('quotes: sends the allow-listed body and maps base units + ISO to domain', async () => {
    const { client, calls } = routingClient({
      '/markets/create/quote/': {
        body: {
          createId: 'cr_abc123',
          expectedEventPda: EVENT_PDA,
          paymentUsdc: '50000000',
          liquidityInjectionUsdc: '10000000',
          platformRevenueUsdc: '40000000',
          marketType: 'standard',
          expiresAt: '2026-09-04T16:30:00.000000Z',
        },
      },
    });
    const quote = await adapters(client).requestQuote(
      draft,
      'https://cdn.example.com/cover.png',
    );
    expect(quote.paymentUsdc).toBe('50');
    expect(quote.liquidityInjectionUsdc).toBe('10');
    expect(quote.platformRevenueUsdc).toBe('40');
    expect(quote.expectedEventPda).toBe(EVENT_PDA);
    expect(typeof quote.expiresAt).toBe('number');

    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(calls[0]?.url).toBe(
      'https://live-api.panta.market/api/v1/markets/create/quote/',
    );
    expect(sent.wallet).toBe(WALLET);
    expect(sent.category).toBe('crypto');
    expect(sent.imageUrl).toBe('https://cdn.example.com/cover.png');
    // oracle is deliberately never sent (derived server-side).
    expect(sent).not.toHaveProperty('oracle');
  });

  it('rejects a non-http imageUrl before it reaches the network', async () => {
    const { client, calls } = routingClient({});
    await expect(
      adapters(client).requestQuote(draft, 'data:image/png;base64,AAAA'),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('builds: sends createId + wallet and maps the base64 transaction', async () => {
    const { client, calls } = routingClient({
      '/markets/create/build/': {
        body: {
          createId: 'cr_abc123',
          expectedEventPda: EVENT_PDA,
          transaction: 'SGVsbG8gUGFudGE=',
          recentBlockhash: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          lastValidBlockHeight: 300_000_000,
          buildFingerprint: 'abc',
          paymentUsdc: '50000000',
          liquidityInjectionUsdc: '10000000',
          platformRevenueUsdc: '40000000',
          marketType: 'standard',
          expiresAt: '2026-09-04T16:31:00.000000Z',
        },
      },
    });
    const quote = {
      createId: 'cr_abc123' as never,
      expectedEventPda: EVENT_PDA as never,
      paymentUsdc: '50' as never,
      liquidityInjectionUsdc: '10' as never,
      platformRevenueUsdc: '40' as never,
      expiresAt: unixSeconds(1_700_000_000),
    };
    const build = await adapters(client).buildCreate(quote);
    expect(build.transaction).toBe('SGVsbG8gUGFudGE=');
    expect(build.lastValidBlockHeight).toBe(300_000_000);
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent.createId).toBe('cr_abc123');
    expect(sent.wallet).toBe(WALLET);
  });

  it('accepts a live-shaped build response with no createId/fees', async () => {
    const { client } = routingClient({
      '/markets/create/build/': {
        body: {
          transaction: 'SGVsbG8gUGFudGE=',
          recentBlockhash: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          lastValidBlockHeight: 0,
          buildFingerprint: 'sandbox',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      },
    });
    const quote = { createId: 'cr_abc123' as never } as never;
    const build = await adapters(client).buildCreate(quote);
    expect(build.transaction).toBe('SGVsbG8gUGFudGE=');
  });

  it('refuses an empty transaction (sandbox build has nothing to sign)', async () => {
    const { client } = routingClient({
      '/markets/create/build/': {
        body: {
          transaction: '',
          recentBlockhash: 'SandboxBlockhash11111111111111111111111111111',
          lastValidBlockHeight: 0,
          buildFingerprint: 'sandbox',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      },
    });
    const quote = { createId: 'cr_abc123' as never } as never;
    await expect(adapters(client).buildCreate(quote)).rejects.toBeInstanceOf(
      PantaCallError,
    );
  });

  it('registers: maps the returned market id', async () => {
    const { client } = routingClient({
      '/markets/register/': {
        body: {
          createId: 'cr_abc123',
          marketId: 'mkt_reg_1',
          status: 'registered',
          signature: '5VEJv1R',
          category: 'crypto',
          title: 't',
          images: [],
        },
      },
    });
    const quote = { createId: 'cr_abc123' as never } as never;
    const id = await adapters(client).register(
      quote,
      txSignature('1'.repeat(88)),
    );
    expect(id).toBe('mkt_reg_1');
  });

  it('wires the injected source verifier; unverified sources stay unverified', async () => {
    const { client } = routingClient({});
    const injected = async (url: string) =>
      url.startsWith('https://public.example.com')
        ? { ok: true }
        : { ok: false, reason: 'blocked by fixture' };
    const ad = createPantaCreateAdapters({
      client,
      wallet: WALLET,
      generateDraft: async () => {
        throw new Error('generateDraft not under test');
      },
      uploadImage: async () => 'https://cdn.example.com/cover.png',
      signCreate: async () => txSignature('1'.repeat(88)),
      now: () => unixSeconds(1_700_000_000),
      verifySource: injected,
    });
    await expect(ad.verifySource('https://public.example.com/x')).resolves.toEqual({
      ok: true,
    });
    await expect(
      ad.verifySource('https://internal.example.com/x'),
    ).resolves.toEqual({ ok: false, reason: 'blocked by fixture' });
  });

  it('surfaces a transport failure as a typed PantaCallError', async () => {
    const { client } = routingClient({
      '/markets/create/quote/': {
        status: 400,
        body: {
          code: 'INVALID_MARKET_PARAMS',
          message: 'startTime too soon',
          fields: { startTime: ['too soon'] },
        },
      },
    });
    await expect(
      adapters(client).requestQuote(draft, 'https://cdn.example.com/cover.png'),
    ).rejects.toBeInstanceOf(PantaCallError);
  });
});

// The standalone functions are the exact seam the create ROUTES call, with the
// wallet bound from the session. These pin the properties the routes rely on.

describe('requestCreateQuote / buildCreateTransaction (route seam)', () => {
  it('binds the wallet from the argument, never from the draft (Phase 3)', async () => {
    const { client, calls } = routingClient({
      '/markets/create/quote/': {
        body: {
          createId: 'cr_abc123',
          expectedEventPda: EVENT_PDA,
          paymentUsdc: '50000000',
          liquidityInjectionUsdc: '10000000',
          platformRevenueUsdc: '40000000',
          expiresAt: '2026-09-04T16:30:00.000000Z',
        },
      },
    });
    // A hostile draft that tries to smuggle its own fee payer alongside the
    // fields the schema accepts.
    const hostile = {
      ...draft,
      wallet: 'Attacker1111111111111111111111111111111',
    } as CreateQuoteDraftInput & { wallet: string };

    const quote = await requestCreateQuote(
      client,
      WALLET,
      hostile,
      'https://cdn.example.com/cover.png',
    );
    expect(quote.paymentUsdc).toBe('50');

    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent.wallet).toBe(WALLET);
    // The domain markers and any smuggled key are never forwarded.
    expect(sent).not.toHaveProperty('injection');
    expect(sent).not.toHaveProperty('resolvable');
    expect(sent).not.toHaveProperty('resolvability');
  });

  it('refuses a data: imageUrl before it reaches the network (Phase 4)', async () => {
    const { client, calls } = routingClient({});
    await expect(
      requestCreateQuote(client, WALLET, draft, 'data:image/png;base64,AAAA'),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('sends the session wallet with the create id (Phase 3: cross-account build)', async () => {
    const { client, calls } = routingClient({
      '/markets/create/build/': {
        body: {
          transaction: 'SGVsbG8gUGFudGE=',
          recentBlockhash: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          lastValidBlockHeight: 300_000_000,
          buildFingerprint: 'abc',
          expiresAt: '2026-09-04T16:31:00.000000Z',
        },
      },
    });
    const build = await buildCreateTransaction(client, WALLET, 'cr_abc123');
    expect(build.transaction).toBe('SGVsbG8gUGFudGE=');
    const sent = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(sent.createId).toBe('cr_abc123');
    expect(sent.wallet).toBe(WALLET);
  });

  it('refuses an empty build transaction (Phase 2: nothing signable can reach a wallet)', async () => {
    const { client } = routingClient({
      '/markets/create/build/': {
        body: {
          transaction: '',
          recentBlockhash: 'SandboxBlockhash11111111111111111111111111111',
          lastValidBlockHeight: 0,
          buildFingerprint: 'sandbox',
          expiresAt: '2099-01-01T00:00:00Z',
        },
      },
    });
    await expect(
      buildCreateTransaction(client, WALLET, 'cr_abc123'),
    ).rejects.toBeInstanceOf(PantaCallError);
  });
});
