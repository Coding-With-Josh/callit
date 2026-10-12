import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_PER_WINDOW,
  WINDOW_MS,
  checkSourceRateLimit,
  clientKey,
  resetSourceRateLimit,
  sourceRateLimitTrackedKeys,
} from './source-rate-limit';

const reader = (headers: Record<string, string>) => ({
  headers: { get: (name: string) => headers[name] ?? null },
});

beforeEach(() => {
  resetSourceRateLimit();
});

describe('clientKey', () => {
  it('uses the first hop of x-forwarded-for', () => {
    // A proxy chain appends; only the first hop is the caller.
    expect(clientKey(reader({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' }))).toBe(
      '203.0.113.7',
    );
  });

  it('falls back to x-real-ip, then to a shared unknown bucket', () => {
    expect(clientKey(reader({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientKey(reader({}))).toBe('unknown');
    expect(clientKey(reader({ 'x-forwarded-for': '  ' }))).toBe('unknown');
  });
});

describe('checkSourceRateLimit', () => {
  it('allows up to the budget, then refuses with a retry hint', () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) {
      expect(checkSourceRateLimit('a', t).ok).toBe(true);
    }
    const blocked = checkSourceRateLimit('a', t);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_MS / 1000);
  });

  it('isolates keys — one caller cannot exhaust another', () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) checkSourceRateLimit('a', t);
    expect(checkSourceRateLimit('a', t).ok).toBe(false);
    expect(checkSourceRateLimit('b', t).ok).toBe(true);
  });

  it('opens a fresh window once the old one expires', () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) checkSourceRateLimit('a', t);
    expect(checkSourceRateLimit('a', t).ok).toBe(false);
    expect(checkSourceRateLimit('a', t + WINDOW_MS).ok).toBe(true);
  });

  it('counts a refused request as part of the same window (no reset on refusal)', () => {
    const t = 1_000_000;
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) checkSourceRateLimit('a', t);
    checkSourceRateLimit('a', t);
    checkSourceRateLimit('a', t);
    // Still refused, and still holds the SAME window end.
    expect(checkSourceRateLimit('a', t).ok).toBe(false);
  });

  it('keeps the key map bounded when keys are rotated (memory-DoS guard)', () => {
    // Phase 3: an attacker rotating x-forwarded-for must not grow the map
    // without limit. Simulate well past the cap.
    const t = 1_000_000;
    for (let i = 0; i < 12_000; i += 1) {
      checkSourceRateLimit(`k${i}`, t);
    }
    expect(sourceRateLimitTrackedKeys()).toBeLessThanOrEqual(10_000);
    // And the limiter still works for a brand-new caller.
    expect(checkSourceRateLimit('fresh', t).ok).toBe(true);
  });
});
