/**
 * ledger/rate-limit — a shared, atomic fixed-window limiter for the public
 * Blink endpoints.
 *
 * Owns: the `rate_limit` table, its schema bootstrap, and `consumeRateLimit`.
 * Must not import: adapters, React, Next.
 *
 * Why the database and not memory (Phase 2/3, DoS): Blink traffic is public and
 * unauthenticated, and every POST spends Panta's *shared* per-key budget
 * (quotes 30, builds 20 per 60s). An in-process counter is per-serverless-
 * instance, so N instances give an attacker N× the budget — it is not a limit at
 * all. Postgres gives one counter every instance contends on.
 *
 * The increment is a single atomic upsert (`ON CONFLICT … DO UPDATE SET
 * count = count + 1 RETURNING count`). That is deliberate: a read-then-write
 * pair would be a Phase 3 check-and-use race where parallel requests all read
 * `limit - 1` and all pass. One statement cannot.
 *
 * Fail-closed: an unconfigured or unreachable store returns `unavailable`, and
 * the caller denies. We never fall back to "no limit".
 */
import { isLedgerConfigured, query } from './connection';

/** The window every Blink budget is expressed over (Panta's own window). */
export const RATE_LIMIT_WINDOW_SEC = 60;

/** How long past-window rows are kept before opportunistic pruning. */
const RETENTION_SEC = 60 * 60;

export type RateLimitOutcome =
  | { readonly kind: 'allowed'; readonly count: number; readonly limit: number; readonly remaining: number }
  | { readonly kind: 'limited'; readonly retryAfterSec: number; readonly limit: number }
  | { readonly kind: 'unavailable'; readonly message: string };

export interface ConsumeRateLimitArgs {
  /** A coarse family, e.g. "blink:build". Rows are keyed by bucket + key. */
  readonly bucket: string;
  /** The specific subject, e.g. a client IP or the literal "global". */
  readonly key: string;
  readonly limit: number;
  readonly windowSec?: number;
  /** Injectable clock (unix seconds) so the window logic is unit-testable. */
  readonly nowSec?: number;
}

let schemaReady: Promise<void> | null = null;

/** Create the limiter table once per process; reset on failure so it can retry. */
export async function ensureRateLimitSchema(): Promise<void> {
  if (schemaReady === null) {
    schemaReady = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS rate_limit (
           bucket TEXT NOT NULL,
           bucket_key TEXT NOT NULL,
           window_start BIGINT NOT NULL,
           count INT NOT NULL,
           PRIMARY KEY (bucket, bucket_key, window_start)
         )`,
        [],
      );
    })().catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/**
 * Consume one unit from `bucket:key`. Atomic; total (never throws).
 *
 * The returned `retryAfterSec` is the time until the current window rolls over,
 * so a client can honour a `Retry-After` header rather than hammering.
 */
export async function consumeRateLimit(
  args: ConsumeRateLimitArgs,
): Promise<RateLimitOutcome> {
  if (!isLedgerConfigured()) {
    return { kind: 'unavailable', message: 'rate limiting is not configured' };
  }
  const windowSec = args.windowSec ?? RATE_LIMIT_WINDOW_SEC;
  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSec / windowSec) * windowSec;

  try {
    await ensureRateLimitSchema();

    // One atomic statement: increment-or-insert, then read the new count back.
    const rows = await query<{ count: number }>(
      `INSERT INTO rate_limit (bucket, bucket_key, window_start, count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (bucket, bucket_key, window_start)
       DO UPDATE SET count = rate_limit.count + 1
       RETURNING count`,
      [args.bucket, args.key, windowStart],
    );
    const count = rows[0]?.count ?? 0;

    if (count === 1) {
      // First hit of a new window for this key: best-effort prune of old rows.
      // Failure here is harmless (the row just lives longer), so it is swallowed
      // deliberately rather than failing the request that is otherwise fine.
      await query(
        `DELETE FROM rate_limit WHERE bucket = $1 AND window_start < $2`,
        [args.bucket, windowStart - RETENTION_SEC],
      ).catch(() => undefined);
    }

    if (count > args.limit) {
      return {
        kind: 'limited',
        limit: args.limit,
        retryAfterSec: Math.max(1, windowStart + windowSec - nowSec),
      };
    }
    return {
      kind: 'allowed',
      count,
      limit: args.limit,
      remaining: Math.max(0, args.limit - count),
    };
  } catch {
    // Phase 2: a limiter we cannot reach must deny, not wave traffic through.
    return { kind: 'unavailable', message: 'rate limiting is unavailable' };
  }
}

/**
 * The subject a rate-limit key is scoped to.
 *
 * UNVERIFIED/honest limit: `x-forwarded-for` is only trustworthy because Vercel
 * overwrites it at the edge; a client-supplied value on a self-hosted deploy
 * could spoof this key. That is why every caller ALSO consumes a `global`
 * counter — the per-IP limit is a fairness/anti-flood measure, and the global
 * cap is the real backstop against draining Panta's shared budget.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const realIp = headers.get('x-real-ip');
  if (realIp !== null && realIp.length > 0) return realIp;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded.length > 0) {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first.length > 0) return first;
  }
  return 'unknown';
}
