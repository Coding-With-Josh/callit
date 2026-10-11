import { describe, it, expect } from 'vitest';
import {
  unixSecondsSchema,
  isoFromUnix,
  unixFromIso,
  meetsStandardLead,
  isExpired,
  startOfUnixDay,
  MIN_STANDARD_LEAD_SECONDS,
} from './time';

const u = (value: number) => unixSecondsSchema.parse(value);

describe('time', () => {
  it('converts unix seconds to ISO UTC', () => {
    expect(isoFromUnix(u(0))).toBe('1970-01-01T00:00:00.000Z');
  });

  it('round-trips unix -> ISO -> unix', () => {
    const seconds = u(1700000000);
    expect(unixFromIso(isoFromUnix(seconds))).toBe(seconds);
  });

  it('enforces the 3,700-second standard-market lead at the exact boundary', () => {
    expect(MIN_STANDARD_LEAD_SECONDS).toBe(3700);
    // Exactly 3,700s ahead is allowed (inclusive).
    expect(meetsStandardLead(u(3700), u(0))).toBe(true);
    // One second short is not.
    expect(meetsStandardLead(u(3699), u(0))).toBe(false);
    // Same gap, shifted clock.
    expect(meetsStandardLead(u(4700), u(1000))).toBe(true);
    expect(meetsStandardLead(u(4699), u(1000))).toBe(false);
  });

  it('treats expiry as inclusive', () => {
    expect(isExpired(u(100), u(100))).toBe(true);
    expect(isExpired(u(100), u(99))).toBe(false);
  });

  it('floors any instant to the start of its UTC day', () => {
    expect(startOfUnixDay(u(0))).toBe(0);
    expect(startOfUnixDay(u(86_399))).toBe(0);
    expect(startOfUnixDay(u(86_400))).toBe(86_400);
    expect(startOfUnixDay(u(86_400 + 1))).toBe(86_400);
    expect(startOfUnixDay(u(1_700_123_456))).toBe(
      Math.floor(1_700_123_456 / 86_400) * 86_400,
    );
  });

  it('rejects negative or fractional seconds', () => {
    expect(unixSecondsSchema.safeParse(-1).success).toBe(false);
    expect(unixSecondsSchema.safeParse(1.5).success).toBe(false);
  });
});
