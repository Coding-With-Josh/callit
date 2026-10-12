/**
 * blink/limits — the shared budgets the public Blink endpoints spend.
 *
 * Owns: the bucket names, the numeric limits, and the two-bucket admission
 * decision (per-IP fairness + an app-wide cap) in one place so the GET and POST
 * paths cannot drift apart.
 * Must not import: React, Next, or any UI module.
 *
 * Why two buckets (Phase 2/3, DoS): the per-IP key comes from `x-forwarded-for`,
 * which is only trustworthy because Vercel overwrites it at the edge. Off-Vercel
 * it is spoofable, so the per-IP limit is fairness and anti-flood ONLY — the
 * app-wide bucket is the real backstop. On the POST that backstop matters because
 * every request spends Panta's *shared* quote/build budget, which is not
 * replenished by caching.
 *
 * Why the GET has no app-wide cap: its upstream reads are already bounded by the
 * catalog-membership resolver (`lib/blink/market.ts`), so a global request cap
 * would add nothing but a cheap, global availability cliff (one attacker holding
 * a global bucket open 429s every legitimate Blink unfurl). The GET therefore
 * takes a per-IP limit only.
 */
import { APP_REGISTRY } from '@/types';
import {
  clientKeyFromHeaders,
  type ConsumeRateLimitArgs,
  type RateLimitOutcome,
} from '@/lib/ledger/rate-limit';

/** Bucket for the build POST. */
export const BUILD_BUCKET = 'blink:build';

/** Bucket for the metadata GET. */
export const METADATA_BUCKET = 'blink:metadata';

/** The key every app-wide bucket is counted under. */
export const GLOBAL_KEY = 'global';

/**
 * Per-IP fairness cap for the build POST, per window.
 *
 * Deliberately below the app-wide cap so one client cannot consume the app's
 * whole budget, and below one preset's worth of double-taps.
 */
export const BUILD_LIMIT_PER_IP = 2;

/**
 * App-wide cap for the build POST, per window.
 *
 * Derived from the registry rather than hand-typed: one POST costs exactly one
 * quote and one build, and `APP_REGISTRY.blink.rateBudget` declares both as 5,
 * so the app-wide cap and the declared budget are the same number by
 * construction. If the registry budget is raised, this follows it.
 */
export const BUILD_LIMIT_GLOBAL = APP_REGISTRY.blink.rateBudget.builds;

/**
 * Per-IP cap for the metadata GET, per window. Sized for request floods (we are
 * protecting our own CPU and Postgres), NOT for Panta's read budget — the
 * resolver already bounds upstream reads to the catalog size.
 */
export const METADATA_LIMIT_PER_IP = 60;

/** The admission decision after consuming one or two buckets. */
export type LimitDecision =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'limited'; readonly retryAfterSec: number }
  | { readonly kind: 'unavailable' };

/**
 * Map a limiter outcome to an admission decision.
 *
 * Fail closed: `unavailable` (no database, unreachable database, or limiter
 * timeout) denies. There is deliberately no "allow when the limiter is down"
 * branch — that branch is what makes an outage into an unmetered free-for-all.
 */
export function decideLimit(outcome: RateLimitOutcome): LimitDecision {
  if (outcome.kind === 'allowed') return { kind: 'allowed' };
  if (outcome.kind === 'limited') {
    return { kind: 'limited', retryAfterSec: outcome.retryAfterSec };
  }
  return { kind: 'unavailable' };
}

/** One rate-limit bucket to consume: which bucket, under which key, at what cap. */
export interface BucketSpec {
  readonly bucket: string;
  readonly key: string;
  readonly limit: number;
}

/**
 * Consume `buckets` in order and return the first denial.
 *
 * `consume` is injected so the decision logic is unit-testable without a
 * database, and so the route supplies the real `consumeRateLimit`. Sequential
 * on purpose: a denial short-circuits rather than spending the remaining
 * budget, and each bucket is checked at the point of use rather than assumed
 * from the previous one.
 */
export async function admit(
  consume: (args: ConsumeRateLimitArgs) => Promise<RateLimitOutcome>,
  buckets: readonly BucketSpec[],
): Promise<LimitDecision> {
  for (const spec of buckets) {
    const decision = decideLimit(
      await consume({
        bucket: spec.bucket,
        key: spec.key,
        limit: spec.limit,
      }),
    );
    if (decision.kind !== 'allowed') return decision;
  }
  return { kind: 'allowed' };
}

/**
 * The buckets the build POST consults: per-IP fairness first, then the app-wide
 * cap that protects Panta's shared quote/build budget.
 */
export function buildBuckets(headers: Headers): readonly BucketSpec[] {
  return [
    {
      bucket: BUILD_BUCKET,
      key: clientKeyFromHeaders(headers),
      limit: BUILD_LIMIT_PER_IP,
    },
    { bucket: BUILD_BUCKET, key: GLOBAL_KEY, limit: BUILD_LIMIT_GLOBAL },
  ];
}

/** The buckets the metadata GET consults: per-IP only (see the header note). */
export function metadataBuckets(headers: Headers): readonly BucketSpec[] {
  return [
    {
      bucket: METADATA_BUCKET,
      key: clientKeyFromHeaders(headers),
      limit: METADATA_LIMIT_PER_IP,
    },
  ];
}
