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

/**
 * Headroom ABOVE the hard floor that callers should target when they *choose* a
 * start time (as opposed to validating one).
 *
 * Why this exists: the lead rule is `start - now >= 3700`, evaluated against a
 * clock that keeps moving. A draft that seeds its start at EXACTLY the floor is
 * therefore valid for one instant and invalid the next — the wizard generated
 * `now + 3700`, then validated seconds later, so every standard draft failed
 * with "standard markets must start at least 3700s from now" no matter what the
 * user did. Seeding at the floor is the single worst choice available.
 *
 * Targeting floor + margin means the value is still valid after the elapsed time
 * between choosing it and the validator (and the upstream quote) reading it.
 * This is a soft target for *producers*; `meetsStandardLead` stays strict.
 */
export const STANDARD_LEAD_MARGIN_SECONDS = 300;

/**
 * The start time a standard market should be seeded with at `now`: the hard
 * floor plus {@link STANDARD_LEAD_MARGIN_SECONDS} of headroom. Producers (draft
 * seeds, date-input flooring) use this so they never sit on the boundary.
 */
export function standardStartFloor(now: UnixSeconds): UnixSeconds {
  return unixSeconds(now + MIN_STANDARD_LEAD_SECONDS + STANDARD_LEAD_MARGIN_SECONDS);
}

/**
 * Lift a start time that has gone STALE by the time `now` is actually consumed.
 *
 * The lead rule is measured against a moving clock, and `now` is read at more
 * than one moment: the draft step floors its start when the user continues, but
 * the value is really consumed later, when the quote is produced — and Panta
 * measures the lead against ITS clock at that point. The slack above Panta's own
 * `minimumStartDelay` (3600s) is only {@link STANDARD_LEAD_MARGIN_SECONDS}
 * (300s), which is less than the time it takes a person to finish the wizard. A
 * draft floored at Continue is therefore rejected upstream moments later with
 * "startTime must be at least 3600s ahead of now", surfaced to the user as
 * "that draft isn't valid" — for a value the app, not the user, chose.
 *
 * This is the ONE rule, applied wherever `now` is consumed. It mirrors the
 * domain validator's own re-floor exactly, and deliberately:
 *   - only ever moves a start LATER, never earlier, so a later choice by the
 *     user is preserved;
 *   - a start on a PAST day is left alone, because past-date injection must be
 *     rejected rather than silently rescued;
 *   - `usesBreaking` selects the floor: the hard floor (plus headroom) for a
 *     standard market, `now` for a breaking market already in progress.
 *
 * `startTime` must already be well-formed (non-negative integer); `RawDraft`
 * carries a plain number, and the untrusted-input guard belongs at the caller
 * that first reads it.
 */
export function refloorStaleStart(
  startTime: number,
  now: UnixSeconds,
  usesBreaking: boolean,
): UnixSeconds {
  const floor = usesBreaking ? now : standardStartFloor(now);
  if (startOfUnixDay(startTime) < startOfUnixDay(now)) return unixSeconds(startTime);
  return startTime < floor ? floor : unixSeconds(startTime);
}

/** A non-negative integer number of seconds since the Unix epoch. */
export const unixSecondsSchema = z
  .number()
  .int()
  .refine((value) => value >= 0, 'unix seconds must be >= 0')
  .brand<'UnixSeconds'>();
export type UnixSeconds = z.infer<typeof unixSecondsSchema>;

/** Seconds in one UTC day (calendar-day arithmetic; UTC has no DST). */
const DAY_SECONDS = 86_400;

/**
 * The Unix seconds at 00:00:00 UTC of the UTC day containing `value`.
 * The calendar-day floor that backs the "a market can never OPEN on a
 * previous day" rule (Phase 3: past-date injection via LLM output or a
 * crafted request must fail at the validator, not just the date input).
 * Throws on negative input, consistent with the UnixSeconds brand.
 */
export function startOfUnixDay(value: number): UnixSeconds {
  return unixSecondsSchema.parse(Math.floor(value / DAY_SECONDS) * DAY_SECONDS);
}

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
