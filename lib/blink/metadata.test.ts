/**
 * blink/metadata unit tests.
 *
 * Covers the spec-limit sanitation (title/description caps, control-character
 * stripping, badge-survives-truncation) and the buyability gate: a FIXTURE
 * market must never advertise a buy button even though its phase is `primary`
 * (Phase 3: demo-provenance money path), and a graduated market must render
 * read-only.
 */
import { describe, expect, it } from 'vitest';
import { asOf, marketId, priceSchema, unixSeconds, usdcDecimalSchema } from '@/types';
import { getMarketFixture, type MarketFixture } from '@/lib/market-fixtures';
import {
  BLINK_DESCRIPTION_MAX,
  BLINK_TITLE_MAX,
  buildActionMetadata,
  sanitizeCopy,
  sanitizeCopyWithBadge,
} from './metadata';

/** A live, primary market — the only shape that may offer buy buttons. */
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

/** A LIVE, non-primary market — provenance 'live' so the phase is what disables it. */
const LIVE_SECONDARY: MarketFixture = {
  ...LIVE_PRIMARY,
  market: { ...LIVE_PRIMARY.market, phase: 'secondary' },
};

const LONG_TITLE =
  'Will the committee, after reviewing all submitted evidence and testimony, actually reach a final determination before the end of this calendar year?';

describe('sanitizeCopy', () => {
  it('strips control characters before returning', () => {
    const out = sanitizeCopy('line one\nline two\u0000nul', 100);
    expect(out).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(out).toContain('line two');
  });

  it('hard-truncates at `max` with an ellipsis', () => {
    const out = sanitizeCopy('a'.repeat(200), 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('…')).toBe(true);
  });

  it('does not truncate when at or under `max`', () => {
    expect(sanitizeCopy('short', 100)).toBe('short');
  });
});

describe('sanitizeCopyWithBadge', () => {
  it('keeps the required badge when prose would overflow the cap', () => {
    const out = sanitizeCopyWithBadge('x'.repeat(300), BLINK_DESCRIPTION_MAX);
    expect(out.length).toBeLessThanOrEqual(BLINK_DESCRIPTION_MAX);
    expect(out.endsWith(' · Powered by Panta')).toBe(true);
  });
});

describe('buildActionMetadata', () => {
  it('disables a fixture market and offers no buy buttons', () => {
    const fixture = getMarketFixture('demo-primary');
    expect(fixture).not.toBeNull();
    const meta = buildActionMetadata(fixture!);
    expect(meta.disabled).toBe(true);
    expect(meta.links).toBeUndefined();
    expect(meta.label).toBe('Demo market only');
    expect(meta.description).toContain('Demo market, not live');
    expect(meta.description.endsWith('Powered by Panta')).toBe(true);
  });

  it('disables a graduated market with a read-only reason', () => {
    const meta = buildActionMetadata(LIVE_SECONDARY);
    expect(meta.disabled).toBe(true);
    expect(meta.links).toBeUndefined();
    expect(meta.label).toBe('Trading closed');
    expect(meta.description).toContain('read-only here');
  });

  it('offers exactly the preset buttons for a live primary market', () => {
    const meta = buildActionMetadata(LIVE_PRIMARY);
    expect(meta.disabled).toBeUndefined();
    expect(meta.links?.actions).toHaveLength(4);
    expect(meta.links?.actions.map((a) => a.href)).toEqual([
      '/blink/mkt-live-1?side=yes&amount=5',
      '/blink/mkt-live-1?side=yes&amount=25',
      '/blink/mkt-live-1?side=no&amount=5',
      '/blink/mkt-live-1?side=no&amount=25',
    ]);
    for (const action of meta.links?.actions ?? []) {
      expect(action.label).toMatch(/^Back (YES|NO) (5|25) USDC$/);
    }
    expect(meta.description.endsWith('Powered by Panta')).toBe(true);
  });

  it('caps a very long title at the spec limit', () => {
    const longFixture: MarketFixture = {
      ...LIVE_PRIMARY,
      market: { ...LIVE_PRIMARY.market, title: LONG_TITLE },
    };
    const meta = buildActionMetadata(longFixture);
    expect(meta.title.length).toBeLessThanOrEqual(BLINK_TITLE_MAX);
    expect(meta.description.length).toBeLessThanOrEqual(BLINK_DESCRIPTION_MAX);
  });

  it('disables a settled market whose phase string flapped to primary', () => {
    // The flap: Panta's `phase` alternates for the same settled market between
    // reads. If it read "primary" while the market was settled, a phase-only
    // gate would advertise four buy buttons the POST then refuses (Phase 3:
    // buy-control bypass on the share surface).
    const flapped: MarketFixture = {
      ...LIVE_PRIMARY,
      market: { ...LIVE_PRIMARY.market, phase: 'primary', resolved: true },
    };
    const meta = buildActionMetadata(flapped);
    expect(meta.disabled).toBe(true);
    expect(meta.links).toBeUndefined();
    expect(meta.label).toBe('Market resolved');
    expect(meta.description).toContain('This market is resolved.');
  });

  it('describes a settled market as resolved, never as graduated', () => {
    // Both reads of the SAME settled market: one says "resolved", one says
    // "secondary". The card must say the same thing both times.
    for (const phase of ['resolved', 'secondary'] as const) {
      const settled: MarketFixture = {
        ...LIVE_PRIMARY,
        market: { ...LIVE_PRIMARY.market, phase, resolved: true },
      };
      const meta = buildActionMetadata(settled);
      expect(meta.disabled).toBe(true);
      expect(meta.links).toBeUndefined();
      expect(meta.label).toBe('Market resolved');
      expect(meta.description).toContain('This market is resolved.');
      expect(meta.description).not.toContain('graduated');
    }
  });
});