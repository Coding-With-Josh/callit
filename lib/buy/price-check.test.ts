/**
 * Tests for the buy price gate.
 *
 * The gate decides whether a user may compose an order at all, so the cases that
 * matter are the DENY paths: a payload we could not read must never be taken as
 * "no market", an absent market must never be reported as "try again in a moment"
 * as if a re-check would help, and a failing read must not be re-checked as though
 * waiting were the remedy.
 */
import { describe, expect, it } from 'vitest';
import { priceSchema } from '@/types/money';
import {
  PRICE_CHECK_ATTEMPTS,
  checkPrice,
  derivePriceGateState,
  priceGateKey,
  probeOfResponse,
  statusOfProbe,
  type PriceProbe,
} from './price-check';

const PRICED_BODY = {
  market: {
    marketId: 'mkt-1',
    yesPrice: '0.63',
    noPrice: '0.37',
    // Anything else the route returns is not this gate's business; it is ignored,
    // never read.
    title: 'ignored',
    volumeUsdc: '100',
  },
};

describe('statusOfProbe', () => {
  it('is priced only when the read carried both prices', () => {
    expect(statusOfProbe(probeOfResponse({ ok: true, data: PRICED_BODY }))).toBe('priced');
    expect(
      statusOfProbe(probeOfResponse({ ok: true, data: { market: { yesPrice: '0.5', noPrice: null } } })),
    ).toBe('unpriced');
    expect(
      statusOfProbe(probeOfResponse({ ok: true, data: { market: { yesPrice: null, noPrice: null } } })),
    ).toBe('unpriced');
  });

  it('reports a market Panta does not serve as unpriced, not unknown', () => {
    // A re-check cannot price a market that is not there either, but it is still
    // a fact about this market rather than about our read of it.
    expect(statusOfProbe({ kind: 'absent' })).toBe('unpriced');
  });

  it('reports a read we could not make as unknown', () => {
    expect(statusOfProbe({ kind: 'failed' })).toBe('unknown');
  });
});

describe('probeOfResponse', () => {
  it('treats a 404 as absent', () => {
    expect(probeOfResponse({ ok: false, status: 404 })).toEqual({ kind: 'absent' });
  });

  it('treats every other failure as unknown', () => {
    for (const status of [0, 401, 429, 500, 502, 503]) {
      expect(probeOfResponse({ ok: false, status })).toEqual({ kind: 'failed' });
    }
  });

  it('treats an explicit null market as absent', () => {
    expect(probeOfResponse({ ok: true, data: { market: null } })).toEqual({ kind: 'absent' });
  });

  it('never reads an unreadable body as "no market" or as priced', () => {
    // Phase 3 (fail open through a validator): a shape we cannot check must deny.
    for (const data of [
      {},
      null,
      'nonsense',
      { market: { yesPrice: 0.63, noPrice: 0.37 } },
      { market: { yesPrice: 'not a price', noPrice: '0.37' } },
      { market: {} },
    ]) {
      expect(probeOfResponse({ ok: true, data })).toEqual({ kind: 'failed' });
    }
  });
});

describe('checkPrice', () => {
  /** A scripted prober that records how many times it was asked. */
  function scripted(probes: readonly PriceProbe[]) {
    let calls = 0;
    const probe = async (): Promise<PriceProbe> => {
      const result = probes[Math.min(calls, probes.length - 1)]!;
      calls++;
      return result;
    };
    return { probe, calls: () => calls };
  }

  const unpriced: PriceProbe = { kind: 'market', market: { yesPrice: null, noPrice: null } };
  const priced: PriceProbe = {
    kind: 'market',
    market: {
      yesPrice: priceSchema.parse('0.5'),
      noPrice: priceSchema.parse('0.5'),
    },
  };

  it('rides out a short unpriced window and returns priced', async () => {
    const { probe, calls } = scripted([unpriced, unpriced, priced]);
    expect(await checkPrice(probe, { delayMs: 0 })).toBe('priced');
    expect(calls()).toBe(3);
  });

  it('stays bounded when the window never opens', async () => {
    const { probe, calls } = scripted([unpriced]);
    expect(await checkPrice(probe, { delayMs: 0 })).toBe('unpriced');
    expect(calls()).toBe(PRICE_CHECK_ATTEMPTS);
  });

  it('does not re-check a read that failed', async () => {
    // A 5xx or an expired session is not a window: waiting is guesswork, and the
    // user's own "Check again" is the remedy.
    const { probe, calls } = scripted([{ kind: 'failed' }, priced]);
    expect(await checkPrice(probe, { delayMs: 0 })).toBe('unknown');
    expect(calls()).toBe(1);
  });

  it('does not re-check a market that is already priced', async () => {
    const { probe, calls } = scripted([priced, unpriced]);
    expect(await checkPrice(probe, { delayMs: 0 })).toBe('priced');
    expect(calls()).toBe(1);
  });

  it('honours an explicit single-attempt check', async () => {
    // The pre-quote re-check runs once: its job is to avoid composing an order for
    // a market we already know is unpriced, not to wait the window out.
    const { probe, calls } = scripted([unpriced, priced]);
    expect(await checkPrice(probe, { attempts: 1 })).toBe('unpriced');
    expect(calls()).toBe(1);
  });
});

describe('derivePriceGateState', () => {
  const key = priceGateKey('mkt-1', 'live', true);

  it('is preview for a fixture, and never consults a result', () => {
    // A fixture is not a market whose price we failed to read; a stale verdict
    // from a live market must not leak onto it either.
    expect(
      derivePriceGateState({
        provenance: 'fixture',
        active: true,
        key: priceGateKey('mkt-1', 'fixture', true),
        result: { key, status: 'priced' },
      }),
    ).toBe('preview');
  });

  it('is inactive without a session, whatever a stale result says', () => {
    expect(
      derivePriceGateState({ provenance: 'live', active: false, key, result: { key, status: 'priced' } }),
    ).toBe('inactive');
  });

  it('is checking until a result for THESE inputs exists', () => {
    expect(
      derivePriceGateState({ provenance: 'live', active: true, key, result: null }),
    ).toBe('checking');
  });

  it('never displays a verdict that belongs to other inputs', () => {
    // The hole this closes: a "priced" read for a previous market, provenance, or
    // session must not put the buy controls on screen for the current one.
    const stale = [
      { key: priceGateKey('mkt-2', 'live', true), status: 'priced' as const },
      { key: priceGateKey('mkt-1', 'cached', true), status: 'priced' as const },
      { key: priceGateKey('mkt-1', 'live', false), status: 'priced' as const },
    ];
    for (const result of stale) {
      expect(
        derivePriceGateState({ provenance: 'live', active: true, key, result }),
      ).toBe('checking');
    }
  });

  it('displays the verdict once it matches', () => {
    for (const status of ['priced', 'unpriced', 'unknown'] as const) {
      expect(
        derivePriceGateState({ provenance: 'live', active: true, key, result: { key, status } }),
      ).toBe(status);
    }
  });

  it('gives distinct keys to distinct inputs', () => {
    // Distinctness is what the comparison above relies on; a collision would let
    // one market's price stand in for another's.
    const keys = new Set([
      priceGateKey('mkt-1', 'live', true),
      priceGateKey('mkt-2', 'live', true),
      priceGateKey('mkt-1', 'cached', true),
      priceGateKey('mkt-1', 'live', false),
    ]);
    expect(keys.size).toBe(4);
  });
});
