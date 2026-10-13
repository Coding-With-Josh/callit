/**
 * market unit tests — the settled signal and the buy gate.
 *
 * Both exist because Panta's wire `phase` is not stable: it has been observed
 * alternating between "resolved" and "secondary" for the SAME settled market
 * between requests while the `resolved` flag stayed true. Anything keyed on
 * `phase` alone therefore drifts between reads. These tests pin the stable flag
 * as the source of truth and pin the gate as fail-closed.
 */
import { describe, expect, it } from 'vitest';
import { marketIdSchema } from './ids';
import { usdcDecimalSchema } from './money';
import { unixSecondsSchema } from './time';
import {
  MARKET_PHASES,
  effectivePhase,
  isPrimaryMarket,
  isSettled,
  requirePrimaryMarket,
  type Market,
} from './market';

const market = (overrides: Partial<Market> = {}): Market => ({
  marketId: marketIdSchema.parse('m1'),
  category: 'crypto',
  title: 'Will BTC close above $150k?',
  description: 'd',
  phase: 'primary',
  volumeUsdc: usdcDecimalSchema.parse('100'),
  startTime: unixSecondsSchema.parse(0),
  endTime: unixSecondsSchema.parse(10),
  resolutionTime: unixSecondsSchema.parse(20),
  resolved: false,
  yesPrice: null,
  noPrice: null,
  ...overrides,
});

describe('settled signal', () => {
  it('treats the resolved flag and a cancelled phase as settled', () => {
    expect(isSettled(market({ resolved: true }))).toBe(true);
    expect(isSettled(market({ phase: 'cancelled' }))).toBe(true);
    expect(isSettled(market({ phase: 'primary' }))).toBe(false);
    // The flapping pair: both reads of the SAME settled market are settled.
    expect(isSettled(market({ phase: 'resolved', resolved: true }))).toBe(true);
    expect(isSettled(market({ phase: 'secondary', resolved: true }))).toBe(true);
  });

  it('normalises the flapping phase so a settled market reads as resolved', () => {
    expect(effectivePhase(market({ phase: 'secondary', resolved: true }))).toBe(
      'resolved',
    );
    expect(effectivePhase(market({ phase: 'resolved', resolved: true }))).toBe(
      'resolved',
    );
    // Cancelled is preserved: no flag marks it.
    expect(effectivePhase(market({ phase: 'cancelled', resolved: true }))).toBe(
      'cancelled',
    );
    expect(effectivePhase(market({ phase: 'primary' }))).toBe('primary');
    expect(effectivePhase(market({ phase: 'secondary' }))).toBe('secondary');
  });
});

describe('requirePrimaryMarket', () => {
  it('accepts a live primary market', () => {
    const result = requirePrimaryMarket(market());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.phase).toBe('primary');
  });

  it('denies a settled market even when the phase string says primary', () => {
    // Phase 3 (buy-control bypass): `phase` flaps, so a settled market whose
    // string read "primary" must NOT be able to render buy controls.
    const result = requirePrimaryMarket(
      market({ phase: 'primary', resolved: true }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('link-out');
      // And the copy it drives is the truthful one, not a "graduated" lie.
      expect(result.error.phase).toBe('resolved');
    }
  });

  it('reports a settled market as resolved whatever the phase string says', () => {
    for (const phase of ['secondary', 'resolved'] as const) {
      const result = requirePrimaryMarket(market({ phase, resolved: true }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.phase).toBe('resolved');
    }
  });

  it('keeps an unresolved graduated market a link-out, never a buy', () => {
    const result = requirePrimaryMarket(market({ phase: 'secondary' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.phase).toBe('secondary');
  });

  it('never reports "primary" as the link-out phase', () => {
    for (const phase of MARKET_PHASES) {
      for (const resolved of [false, true]) {
        const result = requirePrimaryMarket(market({ phase, resolved }));
        if (!result.ok) expect(result.error.phase).not.toBe('primary');
      }
    }
  });

  it('agrees with isPrimaryMarket on every phase/resolved pair', () => {
    for (const phase of MARKET_PHASES) {
      for (const resolved of [false, true]) {
        const candidate = market({ phase, resolved });
        expect(requirePrimaryMarket(candidate).ok).toBe(
          isPrimaryMarket(candidate),
        );
      }
    }
  });
});
