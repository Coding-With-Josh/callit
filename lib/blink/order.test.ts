/**
 * blink/order unit tests — the 10-gate Blink POST pipeline.
 *
 * The POST is unauthenticated, cross-origin, and its output is signed by a
 * stranger's wallet against REAL mainnet USDC. These tests pin the gates that
 * make that safe: operand allowlisting, account parsing, rate limiting
 * (fail-closed), catalog-gated market resolution (here: the injected
 * `loadMarket`), fixture/phase refusal, the quote echo cross-check and the
 * build echo cross-check (Phase 3: T3 parameter substitution), the exactly-one
 * signer gate at compile time, the outgoing BODY casing (Phase 3: F6 — the
 * domain `side` must be lowercase 'yes', never 'YES') and the record-before-
 * ship rule (Phase 2: an order we cannot account for is not returned).
 *
 * Framing: `runBlinkOrder` is tested with a real `createPantaClient` whose
 * fetch is a recorder, and a dependency bag for the ledger/market/clock edges.
 * No database and no Next are touched.
 */
import { describe, expect, it } from 'vitest';
import { getBase64Decoder } from '@solana/kit';
import { createPantaClient, type PantaClient } from '@/lib/panta/client';
import { getMarketFixture } from '@/lib/market-fixtures';
import type { MarketFixture } from '@/lib/market-fixtures';
import type { PendingOrderRecord } from '@/lib/ledger/pending-orders';
import {
  asOf,
  marketId,
  priceSchema,
  unixSeconds,
  usdcDecimalSchema,
} from '@/types';
import { decodeUnsignedTransactionB64, getSingleRequiredSigner } from '@/lib/solana/sign';
import {
  runBlinkOrder,
  type BlinkOrderDeps,
  type BlinkOrderFailure,
  type BlinkOrderInput,
  type BlinkOrderOutcome,
} from './order';

/** Structurally valid 32-byte base58 (usable as an address AND a blockhash). */
const PAYER = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';
const OTHER = '8zQRDCnpnpjStPzHb9vz4xTqbvB7vgg5hK41yPY2euif';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const BLOCKHASH = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';

/** Base64 of the 12-byte system-program transfer blob used in sign.test. */
const DATA_B64 = getBase64Decoder().decode(
  new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
);

const LIVE_PRIMARY: MarketFixture = {
  market: {
    marketId: marketId('mkt-live-1'),
    category: 'Crypto',
    title: 'Will BTC close above $150k by Jan 1, 2027?',
    description: 'resolved by Panta.',
    phase: 'primary',
    volumeUsdc: usdcDecimalSchema.parse('100'),
    startTime: unixSeconds(1788220800),
    endTime: unixSeconds(1798675200),
    resolutionTime: unixSeconds(1798761600),
    resolved: false,
    yesPrice: priceSchema.parse('0.62'),
    noPrice: priceSchema.parse('0.38'),
  },
  asOf: asOf('2026-10-10T12:00:00.000Z'),
  provenance: 'live',
  disclaimer: null,
};

/** A LIVE, non-primary market — provenance 'live' so the phase gate is what fires. */
const LIVE_SECONDARY: MarketFixture = {
  market: {
    marketId: marketId('mkt-live-1'),
    category: 'Crypto',
    title: 'Secondary market',
    description: 'resolved by Panta.',
    phase: 'secondary',
    volumeUsdc: usdcDecimalSchema.parse('100'),
    startTime: unixSeconds(1788220800),
    endTime: unixSeconds(1798675200),
    resolutionTime: unixSeconds(1798761600),
    resolved: false,
    yesPrice: priceSchema.parse('0.62'),
    noPrice: priceSchema.parse('0.38'),
  },
  asOf: asOf('2026-10-10T12:00:00.000Z'),
  provenance: 'live',
  disclaimer: null,
};

const SINGLE_SIGNER_INSTRUCTIONS = [
  {
    programId: SYSTEM_PROGRAM,
    data: DATA_B64,
    accounts: [
      { pubkey: PAYER, isSigner: true, isWritable: true },
      { pubkey: PAYER, isSigner: false, isWritable: false },
    ],
  },
];

const MULTI_SIGNER_INSTRUCTIONS = [
  {
    programId: SYSTEM_PROGRAM,
    data: DATA_B64,
    accounts: [
      { pubkey: PAYER, isSigner: true, isWritable: true },
      { pubkey: OTHER, isSigner: true, isWritable: false },
    ],
  },
];

/** Wire response from POST /primaryorderquote/. Amounts are base-unit strings. */
const QUOTE_BODY = {
  quoteId: 'quote-1',
  marketId: 'mkt-live-1',
  side: 'yes',
  amountUsdc: '5000000',
  shares: '7.9365',
  avgPrice: '0.63',
  feeUsdc: '50000',
  expiresAt: '2026-10-12T00:00:00.000Z',
};

/** Wire response from POST /primaryorderbuild/ (`amountUsdc` is a DECIMAL string). */
const BUILD_BODY = {
  orderId: 'order-1',
  quoteId: 'quote-1',
  wallet: PAYER,
  marketId: 'mkt-live-1',
  side: 'yes',
  amountUsdc: '5',
  expectedShares: '7.9365',
  feeUsdc: '50000',
  status: 'ready',
  instructions: SINGLE_SIGNER_INSTRUCTIONS,
  derived: {},
  recentBlockhash: BLOCKHASH,
  lastValidBlockHeight: 0,
  expiresAt: '2026-10-12T00:00:00.000Z',
};

type WireOverrides = Record<string, unknown>;

interface RecordedCall {
  path: string;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A Panta client whose fetch records every call and answers per endpoint. */
function makePantaClient(overrides: {
  quote?: WireOverrides;
  build?: WireOverrides;
  quoteStatus?: number;
} = {}): { client: PantaClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const path = String(url);
    let body: unknown = null;
    try {
      body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    } catch {
      body = null;
    }
    calls.push({ path, body });
    if (path.endsWith('/primaryorderquote/')) {
      return jsonResponse(overrides.quote ?? QUOTE_BODY, overrides.quoteStatus ?? 200);
    }
    if (path.endsWith('/primaryorderbuild/')) {
      return jsonResponse(overrides.build ?? BUILD_BODY);
    }
    return jsonResponse({ error: 'unknown' }, 404);
  };
  const client = createPantaClient({
    apiKey: 'test-key',
    baseUrl: 'https://live-api.panta.market/api/v1',
    fetchImpl,
  });
  return { client, calls };
}

function allowed(): { kind: 'allowed'; count: number; limit: number; remaining: number } {
  return { kind: 'allowed', count: 1, limit: 10, remaining: 9 };
}

function makeDeps(client: PantaClient, overrides: Partial<BlinkOrderDeps> = {}) {
  const recorded: PendingOrderRecord[] = [];
  const deps: BlinkOrderDeps = {
    client,
    loadMarket: async () => LIVE_PRIMARY,
    recordOrder: async (record) => {
      recorded.push(record);
    },
    consumeLimit: async () => allowed(),
    nowSec: () => 1_700_000_000,
    ...overrides,
  };
  return { deps, recorded };
}

function makeInput(
  search = 'side=yes&amount=5',
  bodyText: string | null = JSON.stringify({ account: PAYER }),
  marketId = 'mkt-live-1',
): BlinkOrderInput {
  return {
    marketId,
    searchParams: new URLSearchParams(search),
    bodyText,
    headers: new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  };
}

/**
 * Assert an outcome failed and return its failure, narrowed. `expect(...).toBe`
 * cannot narrow a discriminated union, so every payload assertion narrows via a
 * `kind ===` comparison after this.
 */
function failureOf(outcome: BlinkOrderOutcome): BlinkOrderFailure {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error('expected a failure outcome');
  return outcome.failure;
}

describe('runBlinkOrder — happy path', () => {
  it('quotes, builds, assembles, records and returns a one-signer transaction', async () => {
    const { client, calls } = makePantaClient();
    const { deps, recorded } = makeDeps(client);

    const outcome = await runBlinkOrder(makeInput(), deps);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // The returned bytes must be exactly what a wallet is asked to sign, and
    // they must require only the request account.
    expect(outcome.transaction.length).toBeGreaterThan(0);
    expect(getSingleRequiredSigner(decodeUnsignedTransactionB64(outcome.transaction))).toBe(PAYER);

    // Message copy: side label + badge.
    expect(outcome.message).toContain('Back YES with 5 USDC');
    expect(outcome.message.endsWith('Powered by Panta')).toBe(true);

    // Exactly one quote and one build call.
    expect(calls).toHaveLength(2);

    // Phase 3 (F6 regression): the outgoing quote body carries the DOMAIN
    // lowercase side, never 'YES', plus the blink attribution as body userId.
    expect(calls[0]!.path).toMatch(/\/primaryorderquote\/$/);
    expect(calls[0]!.body).toMatchObject({
      wallet: PAYER,
      marketId: 'mkt-live-1',
      side: 'yes',
      amountUsdc: '5',
      userId: 'callit:v1:blink:blink',
    });
    expect(calls[1]!.path).toMatch(/\/primaryorderbuild\/$/);
    expect(calls[1]!.body).toMatchObject({
      quoteId: 'quote-1',
      wallet: PAYER,
      userId: 'callit:v1:blink:blink',
    });

    // Gate 10: the row is on the ledger before the transaction ships.
    expect(recorded).toHaveLength(1);
    const record = recorded[0]!;
    expect(record.orderId).toBe('order-1');
    expect(record.marketId).toBe('mkt-live-1');
    expect(record.side).toBe('yes');
    expect(record.wallet).toBe(PAYER);
    expect(record.status).toBe('built');
    expect(record.signature).toBeNull();
    expect(record.sourceApp).toBe('blink');
    expect(record.volumeClass).toBe('user');
  });
});

describe('runBlinkOrder — perimeter gates', () => {
  it('refuses operands outside the closed allowlist', async () => {
    const { client } = makePantaClient();
    const { deps } = makeDeps(client);
    const outcome = await runBlinkOrder(makeInput('side=YES&amount=5'), deps);
    expect(failureOf(outcome).kind).toBe('invalid-order');
  });

  it('refuses a body that is not JSON or not a valid account', async () => {
    const { client } = makePantaClient();
    const { deps } = makeDeps(client);
    for (const body of ['not json', JSON.stringify({ account: 'not-an-address' }), null]) {
      const outcome = await runBlinkOrder(makeInput('side=yes&amount=5', body), deps);
      expect(failureOf(outcome).kind).toBe('invalid-account');
    }
  });

  it('rate-limits per the injected limiter decision', async () => {
    const { client } = makePantaClient();
    const { deps } = makeDeps(client, {
      consumeLimit: async () => ({ kind: 'limited', retryAfterSec: 42, limit: 2 }),
    });
    const outcome = await runBlinkOrder(makeInput(), deps);
    const failure = failureOf(outcome);
    expect(failure.kind).toBe('rate-limited');
    if (failure.kind === 'rate-limited') {
      expect(failure.retryAfterSec).toBe(42);
    }
  });

  it('denies when the limiter itself is unavailable (never "no limit")', async () => {
    const { client } = makePantaClient();
    const { deps } = makeDeps(client, {
      consumeLimit: async () => ({ kind: 'unavailable', message: 'no db' }),
    });
    const outcome = await runBlinkOrder(makeInput(), deps);
    expect(failureOf(outcome).kind).toBe('unavailable');
  });
});

describe('runBlinkOrder — market gates', () => {
  it('refuses an unlisted market (market-not-found)', async () => {
    const { client } = makePantaClient();
    const { deps } = makeDeps(client, { loadMarket: async () => null });
    const outcome = await runBlinkOrder(makeInput(), deps);
    expect(failureOf(outcome).kind).toBe('market-not-found');
  });

  it('refuses a fixture-provenance market (never a demo-money path)', async () => {
    const { client } = makePantaClient();
    const { deps } = makeDeps(client, {
      loadMarket: async () => getMarketFixture('demo-primary'),
    });
    const outcome = await runBlinkOrder(makeInput(), deps);
    expect(failureOf(outcome).kind).toBe('fixture-market');
  });

  it('refuses a non-primary market', async () => {
    const { client } = makePantaClient();
    const { deps } = makeDeps(client, {
      loadMarket: async () => LIVE_SECONDARY,
    });
    const outcome = await runBlinkOrder(makeInput(), deps);
    expect(failureOf(outcome).kind).toBe('market-not-buyable');
  });
});

describe('runBlinkOrder — upstream echo cross-checks (Phase 3: T3)', () => {
  it('refuses a quote that did not answer for the requested market/side', async () => {
    const { client } = makePantaClient({ quote: { ...QUOTE_BODY, side: 'no' } });
    const { deps } = makeDeps(client);
    const outcome = await runBlinkOrder(makeInput(), deps);
    const failure = failureOf(outcome);
    expect(failure.kind).toBe('upstream');
    if (failure.kind === 'upstream') {
      expect(failure.detail).toContain('did not match');
    }
  });

  it('refuses a build whose echo does not match the requested order', async () => {
    const { client } = makePantaClient({ build: { ...BUILD_BODY, wallet: OTHER } });
    const { deps } = makeDeps(client);
    const outcome = await runBlinkOrder(makeInput(), deps);
    const failure = failureOf(outcome);
    expect(failure.kind).toBe('upstream');
    if (failure.kind === 'upstream') {
      expect(failure.detail).toContain('did not echo');
    }
  });

  it('maps an upstream transport failure instead of rethrowing', async () => {
    const { client } = makePantaClient({ quoteStatus: 500 });
    const { deps } = makeDeps(client);
    const outcome = await runBlinkOrder(makeInput(), deps);
    const failure = failureOf(outcome);
    expect(failure.kind).toBe('upstream');
    if (failure.kind === 'upstream') {
      expect(failure.transport).not.toBeNull();
    }
  });
});

describe('runBlinkOrder — assemble and record', () => {
  it('refuses instructions that need a second signer (unbuildable)', async () => {
    const { client } = makePantaClient({
      build: { ...BUILD_BODY, instructions: MULTI_SIGNER_INSTRUCTIONS },
    });
    const { deps } = makeDeps(client);
    const outcome = await runBlinkOrder(makeInput(), deps);
    expect(failureOf(outcome).kind).toBe('unbuildable');
  });

  it('refuses to return a transaction when the ledger write fails (record before ship)', async () => {
    const { client } = makePantaClient();
    const { deps } = makeDeps(client, {
      recordOrder: async () => {
        throw new Error('db is down');
      },
    });
    const outcome = await runBlinkOrder(makeInput(), deps);
    const failure = failureOf(outcome);
    expect(failure.kind).toBe('unavailable');
    if (failure.kind === 'unavailable') {
      expect(failure.detail).toContain('could not be recorded');
    }
    // The transaction must never leak out through another channel.
    expect('transaction' in outcome).toBe(false);
  });
});