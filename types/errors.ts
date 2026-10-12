/**
 * errors — Panta error codes, the typed error union, and classification.
 *
 * Owns: the closed set of KNOWN Panta error codes (with a typed UNKNOWN
 * fallback that preserves the raw code), the wire error body schema, and the
 * retryable / terminal / user-fixable classification.
 * Must not import: domain state machines, panta-wire adapters, or any framework.
 *
 * The code set is now the documented set (docs.panta.market → guides/errors).
 * `VALIDATION_ERROR` was a fabricated code and is replaced by the real
 * `INVALID_MARKET_PARAMS`. The `unknown` branch stays: the docs are authoritative
 * for today, not a promise about tomorrow, so a novel code must never crash or
 * be silently retried.
 */
import { z } from 'zod';

/** The documented Panta error codes. */
export const KNOWN_PANTA_ERROR_CODES = [
  'UNAUTHORIZED',
  'EMAIL_TAKEN',
  'CREATE_NOT_PERMITTED',
  'FORBIDDEN',
  'INVALID_MARKET_PARAMS',
  'DUPLICATE_MARKET',
  'CREATE_EXPIRED',
  'QUOTE_EXPIRED',
  'QUOTE_STALE',
  'AMOUNT_TOO_SMALL',
  'MARKET_NOT_FOUND',
  'MARKET_NOT_IN_PRIMARY',
  'NOT_CLAIMABLE',
  'NOT_MARKET_CREATOR',
  'MARKET_NOT_GRADUATED',
  'NO_CREATOR_FEES',
  'UPLOAD_NOT_CONFIGURED',
  'TX_NOT_FOUND',
  'TX_FAILED',
  'TX_MISMATCH',
  'TX_FEE_MISMATCH',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type KnownPantaErrorCode = (typeof KNOWN_PANTA_ERROR_CODES)[number];

/** Zod schema for the closed set of known Panta error codes. */
export const knownPantaErrorCodeSchema = z.enum(KNOWN_PANTA_ERROR_CODES);

/**
 * The raw Panta error body: { code, message, field?, fields? }. `field` is a
 * single offending field (e.g. "startTime"); `fields` is the serializer shape,
 * a per-field list of messages. Unknown keys are ignored.
 *
 * `message` is OPTIONAL, on live evidence: the register endpoint answers a
 * missing transaction with exactly `{"code":"TX_NOT_FOUND"}` and no message.
 * Requiring it here did not merely drop a display string — the whole envelope
 * failed to parse, so the real CODE was discarded and replaced with a synthetic
 * `HTTP_<status>` (see the client's error branch). Every code-driven decision
 * was then wrong for those responses: `classifyPantaError` could not see that
 * TX_NOT_FOUND is retryable, and a caller could not tell "Panta holds no
 * transaction" from "we do not know what happened". The code is the contract;
 * the message is human-facing and may be absent.
 */
export const pantaErrorBodySchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  field: z.string().optional(),
  fields: z.record(z.string(), z.array(z.string())).optional(),
});
export type PantaErrorBody = z.infer<typeof pantaErrorBodySchema>;

/** How a caller should react to an error. */
export type PantaErrorClass = 'retryable' | 'terminal' | 'user-fixable';

/** Fields shared by known and unknown errors. */
export interface PantaErrorBase {
  readonly message: string;
  readonly field?: string;
  readonly fields?: Readonly<Record<string, readonly string[]>>;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
}

/** A Panta error whose code is in the known set. */
export interface KnownPantaError extends PantaErrorBase {
  readonly kind: 'known';
  readonly code: KnownPantaErrorCode;
}

/** A Panta error whose code is not yet in the known set; the raw code is preserved. */
export interface UnknownPantaError extends PantaErrorBase {
  readonly kind: 'unknown';
  readonly rawCode: string;
}

/** The parsed Panta error union. */
export type PantaError = KnownPantaError | UnknownPantaError;

/**
 * Classification drives automatic retry, so the only dangerous mistake is
 * marking a non-transient failure `retryable` (a money op retried against a
 * permanent error). Codes meaning "refresh the quote / poll the indexer / back
 * off" are retryable; the rest are not.
 *
 * These three lists must PARTITION KNOWN_PANTA_ERROR_CODES exactly — enforced
 * by a unit test, so adding a code without classifying it fails the suite.
 */
export const RETRYABLE_PANTA_ERROR_CODES = [
  'QUOTE_EXPIRED',
  'QUOTE_STALE',
  'CREATE_EXPIRED',
  'TX_NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'UPLOAD_NOT_CONFIGURED',
] as const;

export const USER_FIXABLE_PANTA_ERROR_CODES = [
  'EMAIL_TAKEN',
  'INVALID_MARKET_PARAMS',
  'DUPLICATE_MARKET',
  'AMOUNT_TOO_SMALL',
  'MARKET_NOT_IN_PRIMARY',
  'NOT_CLAIMABLE',
  'NOT_MARKET_CREATOR',
  'MARKET_NOT_GRADUATED',
  'NO_CREATOR_FEES',
] as const;

export const TERMINAL_PANTA_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'CREATE_NOT_PERMITTED',
  'MARKET_NOT_FOUND',
  'TX_FAILED',
  'TX_MISMATCH',
  'TX_FEE_MISMATCH',
] as const;

const KNOWN_SET: ReadonlySet<string> = new Set(KNOWN_PANTA_ERROR_CODES);
const RETRYABLE_SET: ReadonlySet<string> = new Set(RETRYABLE_PANTA_ERROR_CODES);
const USER_FIXABLE_SET: ReadonlySet<string> = new Set(
  USER_FIXABLE_PANTA_ERROR_CODES,
);

/** Parse a raw error body into the typed union, mapping unknown codes to the fallback. */
export function parsePantaError(
  body: PantaErrorBody,
  status?: number,
  retryAfterSeconds?: number,
): PantaError {
  const base: PantaErrorBase = {
    // Never invent text from upstream, but never drop the code over a missing
    // message either — a neutral placeholder carries the status instead. The
    // placeholder is derived from our own status, never from the response.
    message:
      body.message ??
      (status !== undefined
        ? `Panta returned HTTP ${status}`
        : 'Panta request failed'),
    ...(body.field !== undefined ? { field: body.field } : {}),
    ...(body.fields !== undefined ? { fields: body.fields } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
  if (KNOWN_SET.has(body.code)) {
    return { kind: 'known', code: body.code as KnownPantaErrorCode, ...base };
  }
  return { kind: 'unknown', rawCode: body.code, ...base };
}

/**
 * Classify an error. Unknown codes are classified `terminal` (fail-closed: we
 * never blindly retry an error we do not understand). Known-but-unlisted codes
 * fall through to `terminal` as well, and the partition test guarantees there
 * are none.
 */
export function classifyPantaError(error: PantaError): PantaErrorClass {
  if (error.kind === 'unknown') return 'terminal';
  if (RETRYABLE_SET.has(error.code)) return 'retryable';
  if (USER_FIXABLE_SET.has(error.code)) return 'user-fixable';
  return 'terminal';
}

/** True when the error is safe to retry (e.g. QUOTE_EXPIRED, TX_NOT_FOUND). */
export function isRetryable(error: PantaError): boolean {
  return classifyPantaError(error) === 'retryable';
}

/** Per-field validation messages, or an empty record when there are none. */
export function fieldErrors(
  error: PantaError,
): Readonly<Record<string, readonly string[]>> {
  return error.fields ?? {};
}
