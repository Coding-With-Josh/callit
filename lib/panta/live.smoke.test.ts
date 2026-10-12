/**
 * Live smoke test against the real Panta API. SKIPPED unless PANTA_API_KEY is
 * exported (so it never runs in CI and never hits the network by default). Run:
 *
 *   set -a; . ./.env.local; set +a; \
 *     pnpm exec vitest run lib/panta/live.smoke.test.ts
 *
 * It exercises the reads and the create quote/build WIRE contracts, and asserts
 * that the domain mapping fails closed on the pk_test sandbox (fake 30-byte
 * "PDA", empty transaction). It NEVER signs or broadcasts.
 */
import { describe, it, expect } from 'vitest';
import {
  createBuildRequestSchema,
  createQuoteResponseSchema,
  createQuoteRequestSchema,
  createBuildResponseSchema,
  txSignature,
  unixSeconds,
  type ResolvableDraft,
} from '@/types';
import { pantaClientFromEnv, PantaCallError } from './client';
import { fetchCategories, fetchMarketList } from './read-adapters';
import { createPantaCreateAdapters } from './create-adapters';

const live = process.env.PANTA_API_KEY ? describe : describe.skip;

function client() {
  const result = pantaClientFromEnv();
  if (!result.ok) throw new Error('PANTA_API_KEY missing');
  return result.value;
}

function draft(): ResolvableDraft {
  const now = Math.floor(Date.now() / 1000);
  return {
    question: 'Live smoke: will this quote validate?',
    resolutionRule:
      'Resolves to YES if the smoke test quote endpoint accepts this draft; otherwise NO.',
    sourcesOfTruth: ['https://www.coingecko.com'],
    category: 'crypto',
    startTime: now + 172800,
    endTime: now + 2592000,
    resolutionTime: now + 2678400,
    marketType: 'standard',
    eventInProgress: false,
    injection: { suspicious: false, reasons: [] },
    validated: true,
    resolvable: true,
    resolvability: { resolvable: true, reasons: [], suggestions: [] },
  };
}

live('panta live smoke', () => {
  it('reads categories and the market list (domain-mapped)', async () => {
    const c = client();
    const categories = await fetchCategories(c);
    expect(categories.ok).toBe(true);
    if (categories.ok) expect(categories.value.categories.length).toBeGreaterThan(0);

    const markets = await fetchMarketList(c, { limit: 5 });
    expect(markets.ok).toBe(true);
    if (markets.ok) {
      for (const market of markets.value.markets) {
        expect(typeof market.startTime).toBe('number');
        expect(market.volumeUsdc).toMatch(/^\d+(\.\d+)?$/);
      }
    }
  });

  it('quote/build wire contracts hold against live Panta', async () => {
    const c = client();
    const body = createQuoteRequestSchema.parse({
      wallet: 'Creator1111111111111111111111111111111',
      question: draft().question,
      resolutionRule: draft().resolutionRule,
      sourcesOfTruth: draft().sourcesOfTruth,
      category: draft().category,
      startTime: draft().startTime,
      endTime: draft().endTime,
      resolutionTime: draft().resolutionTime,
      imageUrl: 'https://picsum.photos/1024',
      marketType: 'standard',
    });

    const quote = await c.request({
      method: 'POST',
      path: '/markets/create/quote/',
      body,
      schema: createQuoteResponseSchema,
    });
    expect(quote.ok).toBe(true);
    if (!quote.ok) return;

    const build = await c.request({
      method: 'POST',
      path: '/markets/create/build/',
      body: createBuildRequestSchema.parse({
        createId: quote.value.createId,
        wallet: 'Creator1111111111111111111111111111111',
      }),
      schema: createBuildResponseSchema,
    });
    expect(build.ok).toBe(true);
  });

  it('domain mapping fails closed on the sandbox fixture quote', async () => {
    const adapters = createPantaCreateAdapters({
      client: client(),
      wallet: 'Creator1111111111111111111111111111111',
      generateDraft: async () => {
        throw new Error('unused');
      },
      uploadImage: async () => 'https://picsum.photos/1024',
      signCreate: async () => txSignature('1'.repeat(88)),
      broadcastCreate: async () => txSignature('1'.repeat(88)),
      now: () => unixSeconds(Math.floor(Date.now() / 1000)),
    });
    // pk_test returns a 30-byte fake PDA, which is not a Solana address, so the
    // adapter must reject it rather than produce a CreateQuote with a bad PDA.
    await expect(
      adapters.requestQuote(draft(), 'https://picsum.photos/1024'),
    ).rejects.toBeInstanceOf(PantaCallError);
  });
});
