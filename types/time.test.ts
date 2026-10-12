import { describe, it, expect } from 'vitest';
import {
  unixSecondsSchema,
  isoFromUnix,
  unixFromIso,
  meetsStandardLead,
  isExpired,
  startOfUnixDay,
  MIN_STANDARD_LEAD_SECONDS,
  STANDARD_LEAD_MARGIN_SECONDS,
  standardStartFloor,
  refloorStaleStart,
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

  it('seeds a standard start ABOVE the floor, not on it', () => {
    // Regression: a start seeded at exactly the floor is stale one second
    // later, because the rule is measured against a moving clock. The seed
    // must clear the floor by the margin...
    expect(standardStartFloor(u(1000))).toBe(
      1000 + MIN_STANDARD_LEAD_SECONDS + STANDARD_LEAD_MARGIN_SECONDS,
    );
    // ...and still satisfy the strict rule at the moment it is seeded, with
    // room to spare so an immediate re-check (validator, upstream quote) passes.
    const now = u(1000);
    const start = standardStartFloor(now);
    expect(meetsStandardLead(start, now)).toBe(true);
    expect(start - now).toBeGreaterThan(MIN_STANDARD_LEAD_SECONDS);
    // A clock that advances by the margin is still inside the lead.
    expect(meetsStandardLead(start, u(1000 + STANDARD_LEAD_MARGIN_SECONDS))).toBe(
      true,
    );
  });

  it('rejects negative or fractional seconds', () => {
    expect(unixSecondsSchema.safeParse(-1).success).toBe(false);
    expect(unixSecondsSchema.safeParse(1.5).success).toBe(false);
  });
});

describe('refloorStaleStart', () => {
  // Pin the fixtures INSIDE one UTC day: `now` and the stale value must share a
  // day, otherwise the past-day guard (correctly) refuses the lift and the test
  // would be asserting the wrong branch.
  const DAY_START = startOfUnixDay(u(1_790_000_000));
  const NOW = u(DAY_START + 43_200); // mid-day

  it('lifts a stale start to the fresh floor (the elapsed-clock bug)', () => {
    // Floored early in the day, then quoted 40,000s later: still the same day,
    // but now far inside the lead — which is what Panta rejects with
    // "startTime must be at least 3600s ahead of now".
    const stale = u(DAY_START + 3_600);
    expect(refloorStaleStart(stale, NOW, false)).toBe(standardStartFloor(NOW));
  });

  it('leaves an already-valid start untouched', () => {
    const fresh = u(NOW + MIN_STANDARD_LEAD_SECONDS + 10_000);
    expect(refloorStaleStart(fresh, NOW, false)).toBe(fresh);
  });

  it('never moves a later choice earlier', () => {
    // A user who deliberately picked a start well out must keep it, even though
    // it is far beyond the floor.
    const later = u(NOW + 90 * 86_400);
    expect(refloorStaleStart(later, NOW, false)).toBe(later);
  });

  it('never rescues a start on a PAST day (past-date injection)', () => {
    // This is the security-relevant branch: a lift here would silently defeat
    // the validator's past-date wall, so the value must come back unchanged and
    // let validation reject it.
    const yesterday = u(NOW - 86_400);
    expect(refloorStaleStart(yesterday, NOW, false)).toBe(yesterday);
  });

  it('uses `now` as the floor for a breaking market already in progress', () => {
    // A breaking in-progress market is allowed to start immediately, so the
    // standard floor must NOT be applied to it.
    const yesterday = u(NOW - 86_400);
    expect(refloorStaleStart(yesterday, NOW, true)).toBe(yesterday);
    const soon = u(NOW + 5);
    expect(refloorStaleStart(soon, NOW, true)).toBe(soon);
  });
});
