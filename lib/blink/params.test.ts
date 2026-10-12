/**
 * blink/params unit tests — the closed preset allowlist.
 *
 * Phase 3 (amount + side injection): the POST operands come only from the
 * server-baked href, and this parse is a CLOSED allowlist. The tests pin both
 * halves of that: every preset parses for both sides, and anything coercible
 * into a different amount is refused rather than normalized.
 */
import { describe, expect, it } from 'vitest';
import {
  BLINK_AMOUNTS_USDC,
  blinkActionHref,
  parseBlinkOrderParams,
} from './params';

describe('parseBlinkOrderParams', () => {
  it('accepts every preset for both sides', () => {
    for (const amount of BLINK_AMOUNTS_USDC) {
      for (const side of ['yes', 'no'] as const) {
        const r = parseBlinkOrderParams(new URLSearchParams({ side, amount }));
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.value.side).toBe(side);
          expect(r.value.amountUsdc).toBe(amount);
          expect(r.value.amountLabel).toBe(amount);
        }
      }
    }
  });

  it('refuses a missing side', () => {
    const r = parseBlinkOrderParams(new URLSearchParams({ amount: '5' }));
    expect(r).toEqual({ ok: false, error: 'missing side' });
  });

  it('refuses an invalid (e.g. uppercase) side', () => {
    const r = parseBlinkOrderParams(
      new URLSearchParams({ side: 'YES', amount: '5' }),
    );
    expect(r).toEqual({ ok: false, error: 'invalid side' });
  });

  it('refuses a missing amount', () => {
    const r = parseBlinkOrderParams(new URLSearchParams({ side: 'yes' }));
    expect(r).toEqual({ ok: false, error: 'missing amount' });
  });

  it('refuses amounts outside the allowlist, including coercible lookalikes', () => {
    for (const amount of ['50', '05', '5.0', '5e0', ' 5', '0.000005', '025']) {
      const r = parseBlinkOrderParams(new URLSearchParams({ side: 'yes', amount }));
      expect(r).toEqual({ ok: false, error: 'unsupported amount' });
    }
  });
});

describe('blinkActionHref', () => {
  it('builds the server-baked href a client renders', () => {
    expect(blinkActionHref('mkt-1', 'yes', '5')).toBe(
      '/blink/mkt-1?side=yes&amount=5',
    );
    expect(blinkActionHref('mkt-1', 'no', '25')).toBe(
      '/blink/mkt-1?side=no&amount=25',
    );
  });
});