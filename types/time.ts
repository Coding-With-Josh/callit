/**
 * time — time representations and the standard-market lead rule.
 *
 * Owns: UnixSeconds (the wire truth; Panta returns unix seconds), IsoTimestamp
 * (for display), the pure conversions between them, and the boundary-inclusive
 * 3,700-second lead rule for standard (non-breaking) markets.
 * Must not import: money, ids, wallet, or any framework module.
 */
import { z } from 'zod';

/**
 * A standard market must start at least this many seconds in the future.
 * (Panta requires ~1 hour; Callit uses a safer 3,700-second floor.)
 */
export const MIN_STANDARD_LEAD_SECONDS = 3700;

/** A non-negative integer number of seconds since the Unix epoch. */
export const unixSecondsSchema = z
  .number()
  .int()
  .refine((value) => value >= 0, 'unix seconds must be >= 0')
  .brand<'UnixSeconds'>();
export type UnixSeconds = z.infer<typeof unixSecondsSchema>;

/** An ISO-8601 UTC timestamp string, e.g. "2026-01-01T00:00:00.000Z". */
export const isoTimestampSchema = z.iso.datetime().brand<'IsoTimestamp'>();
export type IsoTimestamp = z.infer<typeof isoTimestampSchema>;

/** Parse an untrusted number into UnixSeconds (throws on invalid input). */
export function unixSeconds(value: number): UnixSeconds {
  return unixSecondsSchema.parse(value);
}

/** Pure conversion: Unix seconds -> ISO-8601 UTC string. */
export function isoFromUnix(seconds: UnixSeconds): IsoTimestamp {
  return isoTimestampSchema.parse(new Date(seconds * 1000).toISOString());
}

/** Pure conversion: ISO-8601 UTC string -> Unix seconds (floored to whole seconds). */
export function unixFromIso(iso: IsoTimestamp): UnixSeconds {
  return unixSecondsSchema.parse(Math.floor(Date.parse(iso) / 1000));
}

/** True when `start` is at least MIN_STANDARD_LEAD_SECONDS after `now` (inclusive boundary). */
export function meetsStandardLead(
  start: UnixSeconds,
  now: UnixSeconds,
): boolean {
  return start - now >= MIN_STANDARD_LEAD_SECONDS;
}

/** True when `now` has reached or passed `expiresAt` (inclusive boundary). */
export function isExpired(
  expiresAt: UnixSeconds,
  now: UnixSeconds,
): boolean {
  return now >= expiresAt;
}
