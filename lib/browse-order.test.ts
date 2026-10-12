import { describe, it, expect } from 'vitest';
import { asOf, marketIdSchema, unixSeconds, usdcDecimalSchema, type Market } from '@/types';
import type { MarketFixture } from '@/lib/market-fixtures';
import {
  SORT_KEYS,
  compareMarkets,
  displayTitle,
  effectivePhase,
  isPresentable,
  isSettled,
} from './browse-order';

/**
 * The live wire shape that caused the bug: a settled market whose `phase` string
 * alternates between "secondary" and "resolved" between reads while the
 * `resolved` flag stays true.
 */
const market = (overrides: Partial<Market> = {}): Market => ({
  marketId: marketIdSchema.parse('mkt_1'),
  category: 'crypto',
  title: 'Will BTC close above $150k?',
  description: 'desc',
  phase: 'primary',
  volumeUsdc: usdcDecimalSchema.parse('100'),
  startTime: unixSeconds(1_767_225_600),
  endTime: unixSeconds(1_798_761_599),
  resolutionTime: unixSeconds(1_800_000_000),
  resolved: false,
  yesPrice: null,
  noPrice: null,
  ...overrides,
});

const fixture = (overrides: Partial<Market> = {}): MarketFixture => ({
  market: market(overrides),
  asOf: asOf('2026-10-12T00:00:00.000Z'),
  provenance: 'live',
  disclaimer: null,
});

describe('browse order', () => {
  it('treats a resolved flag or a cancelled phase as settled', () => {
    expect(isSettled(market({ resolved: true }))).toBe(true);
    expect(isSettled(market({ phase: 'cancelled' }))).toBe(true);
    expect(isSettled(market({ phase: 'primary' }))).toBe(false);
    // The flapping pair: both reads of the SAME settled market are settled.
    expect(isSettled(market({ phase: 'resolved', resolved: true }))).toBe(true);
    expect(isSettled(market({ phase: 'secondary', resolved: true }))).toBe(true);
  });

  it('hides an untitled SETTLED market but keeps an untitled LIVE one', () => {
    // Regression: the catalog's only buyable market is untitled, and the old
    // "drop every untitled market" rule hid the only row a visitor could act on.
    expect(isPresentable(fixture({ title: '', resolved: true }))).toBe(false);
    expect(isPresentable(fixture({ title: '   ', resolved: true }))).toBe(false);
    expect(isPresentable(fixture({ title: '', phase: 'primary' }))).toBe(true);
    expect(isPresentable(fixture({ title: 'Titled', resolved: true }))).toBe(true);
  });

  it('never renders a settled market above a live one, for any sort key', () => {
    const settled = fixture({
      resolved: true,
      volumeUsdc: usdcDecimalSchema.parse('9999999'),
      endTime: unixSeconds(1),
      startTime: unixSeconds(2_000_000_000),
    });
    const live = fixture({
      volumeUsdc: usdcDecimalSchema.parse('1'),
      endTime: unixSeconds(2_000_000_000),
      startTime: unixSeconds(1),
    });
    for (const sort of SORT_KEYS) {
      // Live market is worse on every key (least volume, latest close, oldest
      // start) yet must still sort first.
      expect(compareMarkets(live, settled, sort)).toBeLessThan(0);
      expect(compareMarkets(settled, live, sort)).toBeGreaterThan(0);
    }
  });

  it('applies the chosen sort within a rank', () => {
    const rich = fixture({ volumeUsdc: usdcDecimalSchema.parse('84210.5') });
    const poor = fixture({ volumeUsdc: usdcDecimalSchema.parse('0.4') });
    expect(compareMarkets(rich, poor, 'volume')).toBeLessThan(0);
    expect(compareMarkets(poor, rich, 'volume')).toBeGreaterThan(0);
  });

  it('is deterministic when two markets share a sort value', () => {
    // Two untitled live markets share a display title, so the tiebreak must not
    // fall through to an unstable comparison.
    const a = fixture({ title: '', marketId: marketIdSchema.parse('aaa') });
    const b = fixture({ title: '', marketId: marketIdSchema.parse('bbb') });
    expect(compareMarkets(a, b, 'volume')).toBe(0);
    expect(compareMarkets(b, a, 'volume')).toBe(0);
  });

  it('names an untitled market instead of leaving a blank heading', () => {
    expect(displayTitle(market({ title: '' }))).toBe('Untitled market');
    expect(displayTitle(market({ title: '  ' }))).toBe('Untitled market');
    expect(displayTitle(market({ title: '  Padded  ' }))).toBe('Padded');
  });

  it('normalises the flapping phase so a settled market reads as resolved', () => {
    expect(effectivePhase(market({ phase: 'secondary', resolved: true }))).toBe('resolved');
    expect(effectivePhase(market({ phase: 'resolved', resolved: true }))).toBe('resolved');
    expect(effectivePhase(market({ phase: 'cancelled', resolved: true }))).toBe('cancelled');
    expect(effectivePhase(market({ phase: 'primary' }))).toBe('primary');
    expect(effectivePhase(market({ phase: 'secondary' }))).toBe('secondary');
  });
});
