/**
 * source-rate-limit — best-effort, in-process fixed-window limiter for the
 * source-verification route.
 *
 * Why (Phase 3, amplification): /api/sources/verify fetches a CALLER-SUPPLIED
 * URL. It no longer requires a session (product decision, 2026-10-12), so this
 * limiter is the only remaining brake on turning the route into an
 * outbound-request amplifier.
 *
 * HONEST LIMITS — this is a brake, not a boundary:
 *   - Per-process and in memory: it does not survive a restart and is NOT shared
 *     across instances, so N instances allow N x the budget.
 *   - The key is derived from a client-supplied header (`x-forwarded-for`),
 *     which is spoofable unless a trusted proxy overwrites it. Precisely: an
 *     attacker can rotate the header to get a fresh bucket per request. It
 *     raises the cost of casual/accidental abuse; it does not stop a determined
 *     attacker. The SSRF controls in source-verifier.ts are what actually
 *     constrain each request — this only bounds how many are made.
 *   - If a real limiter is needed, it requires a shared store this app does not
 *     have yet. Flagged rather than assumed handled.
 *
 * Pure and time-injected so it is testable without a framework.
 */

/** Window length. */
export const WINDOW_MS = 60_000;
/** Requests allowed per key per window. Deliberately generous: this must not
 *  interfere with a user retrying a handful of sources. */
export const MAX_PER_WINDOW = 120;

/**
 * Upper bound on tracked keys, so a client rotating `x-forwarded-for` cannot
 * grow the map without limit (Phase 3: limiter memory DoS).
 */
const MAX_KEYS = 10_000;

interface Window {
  /** Window start (ms, epoch). */
  readonly start: number;
  count: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  readonly ok: boolean;
  /** Seconds until the window resets. `0` when allowed. */
  readonly retryAfterSeconds: number;
}

/** The minimal request shape needed to derive a caller key. */
export interface HeaderReader {
  headers: { get(name: string): string | null };
}

/**
 * Derive a caller key. `x-forwarded-for` first hop, then `x-real-ip`, else a
 * shared `unknown` bucket. Never throws; a missing header degrades to `unknown`
 * (which means such callers share one budget — acceptable, and fail-closed
 * relative to unlimited).
 */
export function clientKey(req: HeaderReader): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip');
  return real?.trim() || 'unknown';
}

export function checkSourceRateLimit(key: string, nowMs: number): RateLimitResult {
  const existing = windows.get(key);

  if (!existing || nowMs - existing.start >= WINDOW_MS) {
    // Expired or unseen: open a fresh window. Enforce the key cap here so the
    // map cannot grow without bound.
    if (windows.size >= MAX_KEYS && !windows.has(key)) {
      sweepExpired(nowMs);
      if (windows.size >= MAX_KEYS) evictOldest();
    }
    windows.set(key, { start: nowMs, count: 1 });
    return { ok: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= MAX_PER_WINDOW) {
    const remainingMs = WINDOW_MS - (nowMs - existing.start);
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }

  existing.count += 1;
  return { ok: true, retryAfterSeconds: 0 };
}

function sweepExpired(nowMs: number): void {
  for (const [key, window] of windows) {
    if (nowMs - window.start >= WINDOW_MS) windows.delete(key);
  }
}

/** Map preserves insertion order, so the front entries are the oldest. */
function evictOldest(): void {
  const overflow = windows.size - MAX_KEYS + 1;
  let removed = 0;
  for (const key of windows.keys()) {
    if (removed >= overflow) break;
    windows.delete(key);
    removed += 1;
  }
}

/** Test-only: drop all tracked windows. */
export function resetSourceRateLimit(): void {
  windows.clear();
}

/** Test-only: how many keys are currently tracked (cap assertion). */
export function sourceRateLimitTrackedKeys(): number {
  return windows.size;
}
