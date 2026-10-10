import { describe, it, expect } from 'vitest';
import {
  baseUnitStringWireSchema,
  isoTimestampWireSchema,
  derivedAccountsWireSchema,
  marketCategorySlugSchema,
} from './common';

// These are the P1 "trap" controls from Phase 3, pinned so a future edit cannot
// quietly reopen them.

describe('baseUnitStringWireSchema (money unit confusion)', () => {
  it('accepts base-unit integer strings', () => {
    expect(baseUnitStringWireSchema.safeParse('0').success).toBe(true);
    expect(baseUnitStringWireSchema.safeParse('50000000').success).toBe(true);
  });

  it('rejects a decimal string, leading zeros, and negatives', () => {
    // "50.00" is a valid usdcDecimal, so accepting it here would let a unit
    // mix-up render 50 USDC as 50,000,000 USDC downstream.
    expect(baseUnitStringWireSchema.safeParse('50.00').success).toBe(false);
    expect(baseUnitStringWireSchema.safeParse('050000000').success).toBe(false);
    expect(baseUnitStringWireSchema.safeParse('-1').success).toBe(false);
    expect(baseUnitStringWireSchema.safeParse(50).success).toBe(false);
  });
});

describe('isoTimestampWireSchema (timestamp unit confusion)', () => {
  it('accepts the microsecond format Panta actually emits', () => {
    expect(
      isoTimestampWireSchema.safeParse('2026-09-04T16:30:00.000000Z').success,
    ).toBe(true);
  });

  it('accepts second-precision, longer fractions, and offsets', () => {
    expect(isoTimestampWireSchema.safeParse('2026-09-04T16:30:00Z').success).toBe(
      true,
    );
    expect(
      isoTimestampWireSchema.safeParse('2026-09-04T16:30:00.123456789Z').success,
    ).toBe(true);
    expect(
      isoTimestampWireSchema.safeParse('2026-09-04T16:30:00+02:00').success,
    ).toBe(true);
  });

  it('rejects a unix-seconds number and garbage', () => {
    expect(isoTimestampWireSchema.safeParse(1788868800).success).toBe(false);
    expect(isoTimestampWireSchema.safeParse('2026-09-04').success).toBe(false);
    expect(isoTimestampWireSchema.safeParse('').success).toBe(false);
  });
});

describe('derivedAccountsWireSchema (prototype pollution)', () => {
  it('accepts identifier-shaped account keys', () => {
    const parsed = derivedAccountsWireSchema.safeParse({
      event: 'EventPda111',
      vaultAuthority: 'Vault222',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a real own __proto__ key instead of dropping it', () => {
    // `{ __proto__: 'x' }` in a literal sets the prototype (no own key); only
    // JSON.parse produces a real own "__proto__" property, which is the attack.
    const polluted = JSON.parse('{"__proto__":"x"}') as Record<string, unknown>;
    expect(derivedAccountsWireSchema.safeParse(polluted).success).toBe(false);
    const pollutedObj = JSON.parse(
      '{"__proto__":{"polluted":true}}',
    ) as Record<string, unknown>;
    expect(derivedAccountsWireSchema.safeParse(pollutedObj).success).toBe(false);
  });

  it('rejects prototype keys and non-identifier keys', () => {
    expect(derivedAccountsWireSchema.safeParse({ constructor: 'x' }).success).toBe(
      false,
    );
    expect(derivedAccountsWireSchema.safeParse({ prototype: 'x' }).success).toBe(
      false,
    );
    expect(derivedAccountsWireSchema.safeParse({ 'a.b': 'x' }).success).toBe(
      false,
    );
  });
});

describe('marketCategorySlugSchema (category allowlist)', () => {
  it('accepts the documented lowercase slugs', () => {
    expect(marketCategorySlugSchema.safeParse('crypto').success).toBe(true);
    expect(marketCategorySlugSchema.safeParse('other').success).toBe(true);
  });

  it('rejects the legacy capitalized fixture categories', () => {
    expect(marketCategorySlugSchema.safeParse('Crypto').success).toBe(false);
    expect(marketCategorySlugSchema.safeParse('Culture').success).toBe(false);
  });
});
