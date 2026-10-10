import { describe, it, expect } from 'vitest';
import {
  usdcDecimalSchema,
  sharesSchema,
  priceSchema,
  usdcDecimalToBaseUnits,
  baseUnitsToUsdcDecimal,
  baseUnitsToJson,
  baseUnitsFromJson,
  parseVerifyAmount,
} from './money';
import type { UsdcBaseUnits } from './money';

const dec = (value: string) => usdcDecimalSchema.parse(value);

describe('money units', () => {
  it('round-trips decimal USDC through base units', () => {
    const cases: readonly string[] = ['0', '1', '1.5', '0.000001', '123.456789'];
    for (const text of cases) {
      const base = usdcDecimalToBaseUnits(dec(text));
      expect(baseUnitsToUsdcDecimal(base)).toBe(text);
    }
  });

  it('converts known values without floats', () => {
    expect(usdcDecimalToBaseUnits(dec('1.5'))).toBe(BigInt(1500000));
    expect(usdcDecimalToBaseUnits(dec('0.000001'))).toBe(BigInt(1));
    expect(usdcDecimalToBaseUnits(dec('1'))).toBe(BigInt(1000000));
  });

  it('rejects more than 6 decimals and bad shapes', () => {
    expect(usdcDecimalSchema.safeParse('1.2345678').success).toBe(false);
    expect(usdcDecimalSchema.safeParse('01').success).toBe(false);
    expect(usdcDecimalSchema.safeParse('.5').success).toBe(false);
    expect(usdcDecimalSchema.safeParse('-1').success).toBe(false);
  });

  it('round-trips base units through the JSON codec (bigint is not JSON-safe)', () => {
    const base = usdcDecimalToBaseUnits(dec('42.000001'));
    const json = baseUnitsToJson(base);
    expect(json).toBe('42000001');
    expect(baseUnitsFromJson(json)).toBe(base);
    // A bigint would have thrown here; the codec is the reason it does not.
    expect(typeof json).toBe('string');
  });

  it('rejects non-canonical base-unit JSON strings', () => {
    // @ts-expect-error deliberately invalid input to prove the codec validates
    expect(() => baseUnitsFromJson('01')).toThrow();
  });

  it('parses the verify endpoint base-unit number and rejects unsafe values', () => {
    expect(parseVerifyAmount(1500000)).toBe(BigInt(1500000));
    expect(() => parseVerifyAmount(1.5)).toThrow(RangeError);
    expect(() => parseVerifyAmount(-1)).toThrow(RangeError);
    expect(() => parseVerifyAmount(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });

  it('keeps shares and prices in their own shapes', () => {
    expect(sharesSchema.safeParse('10.5').success).toBe(true);
    expect(priceSchema.safeParse('0.62').success).toBe(true);
    expect(priceSchema.safeParse('1.5').success).toBe(false);
  });
});

// A base-unit value is reachable only through a validated constructor.
const viaSchema: UsdcBaseUnits = usdcDecimalToBaseUnits(dec('1'));
void viaSchema;
