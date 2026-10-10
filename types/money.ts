/**
 * money — USDC amounts, share counts and prices, as branded units that cannot
 * be mixed accidentally.
 *
 * Owns: the branded money types, the pure converters between decimal USDC and
 * base units, and the JSON codec for base units (bigint is not JSON-safe, so
 * wire/DB/API envelopes carry base units as decimal-integer strings).
 * Must not import: wallet, ids, time, or any framework module.
 *
 * Rule: no floating-point arithmetic on money, ever. All money math is bigint.
 * USDC has 6 decimals.
 */
import { z } from 'zod';

/** USDC has 6 decimals. */
export const USDC_DECIMALS = 6;

/** One whole USDC expressed in base units. */
export const USDC_SCALE = BigInt(1000000);

/** A USDC amount as a decimal string with at most 6 decimals (e.g. "12.34"). */
export const usdcDecimalSchema = z
  .string()
  .regex(
    /^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/,
    'expected a decimal USDC string with at most 6 decimals',
  )
  .brand<'UsdcDecimal'>();
export type UsdcDecimal = z.infer<typeof usdcDecimalSchema>;

/** A USDC amount as a non-negative integer number of base units (6 decimals). */
export const usdcBaseUnitsSchema = z
  .bigint()
  .refine((value) => value >= BigInt(0), 'base units must be non-negative')
  .brand<'UsdcBaseUnits'>();
export type UsdcBaseUnits = z.infer<typeof usdcBaseUnitsSchema>;

/** Base units as a decimal-integer string, for JSON/DB/API envelopes. */
export const baseUnitsJsonSchema = z
  .string()
  .regex(
    /^(0|[1-9][0-9]*)$/,
    'expected a decimal-integer string of base units',
  )
  .brand<'BaseUnitsJson'>();
export type BaseUnitsJson = z.infer<typeof baseUnitsJsonSchema>;

/** A share count as a decimal string (precision upper bound is UNVERIFIED). */
export const sharesSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)(\.[0-9]{1,9})?$/, 'expected a decimal share count')
  .brand<'Shares'>();
export type Shares = z.infer<typeof sharesSchema>;

/** A price as a decimal string in [0, 1] (yesPrice / noPrice / avgPrice). */
export const priceSchema = z
  .string()
  .regex(/^(0(\.[0-9]{1,9})?|1(\.0{1,9})?)$/, 'expected a price between 0 and 1')
  .brand<'Price'>();
export type Price = z.infer<typeof priceSchema>;

/** Decimal USDC (string) -> base units (bigint). No floats. */
export function usdcDecimalToBaseUnits(value: UsdcDecimal): UsdcBaseUnits {
  const [wholePart, fractionPart = ''] = value.split('.');
  const whole = wholePart ?? '0';
  const paddedFraction = `${fractionPart}000000`.slice(0, USDC_DECIMALS);
  const units = BigInt(whole) * USDC_SCALE + BigInt(paddedFraction);
  return usdcBaseUnitsSchema.parse(units);
}

/** Base units (bigint) -> decimal USDC (string), trailing zeros trimmed. */
export function baseUnitsToUsdcDecimal(value: UsdcBaseUnits): UsdcDecimal {
  const whole = value / USDC_SCALE;
  const fraction = value % USDC_SCALE;
  const fractionText = fraction
    .toString()
    .padStart(USDC_DECIMALS, '0')
    .replace(/0+$/, '');
  const text =
    fractionText.length > 0
      ? `${whole.toString()}.${fractionText}`
      : whole.toString();
  return usdcDecimalSchema.parse(text);
}

/** Base units -> JSON-safe decimal-integer string. */
export function baseUnitsToJson(value: UsdcBaseUnits): BaseUnitsJson {
  return baseUnitsJsonSchema.parse(value.toString());
}

/** JSON decimal-integer string -> base units (re-validates the input). */
export function baseUnitsFromJson(value: BaseUnitsJson): UsdcBaseUnits {
  const canonical = baseUnitsJsonSchema.parse(value);
  return usdcBaseUnitsSchema.parse(BigInt(canonical));
}

/**
 * Parse the verify endpoint's `amountUsdc`, which is a NUMBER in base units
 * (unlike the decimal strings returned by quote and build — a documented quirk).
 * Rejects non-integers and values beyond Number.MAX_SAFE_INTEGER.
 */
export function parseVerifyAmount(raw: number): UsdcBaseUnits {
  if (!Number.isSafeInteger(raw) || raw < 0) {
    throw new RangeError(
      'verify amountUsdc must be a non-negative safe integer in base units',
    );
  }
  return usdcBaseUnitsSchema.parse(BigInt(raw));
}
