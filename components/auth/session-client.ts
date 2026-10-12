/**
 * auth/session-client — client-side helpers for the server session mint.
 *
 * Owns: calling POST /api/auth/session with a Privy identity token, and clearing
 * the server session on logout. Client-only.
 *
 * COST MODEL (learned the hard way): the SDK's bare `getIdentityToken()` is NOT
 * a cheap local read. It awaits `updateUserAndIdToken()`, which calls Privy's
 * RATE-LIMITED `GET /api/v1/users/me`. Calling it per mint — and especially
 * retrying it — earns 429s and makes the mint fail for a user who is
 * demonstrably signed in. So a token we already hold is always preferred, and
 * the refresh path is taken AT MOST ONCE per mint. There is no retry loop.
 *
 * Phase 2 (dependency down): a 503 from the route means Privy is unreachable;
 * we surface `unavailable` and never mint. The signed cookie is unchanged —
 * if one existed it remains valid until its TTL, which is safe (it encodes a
 * previously-verified identity).
 */
'use client';

import { getIdentityToken } from '@privy-io/react-auth';
import type { SessionMintFailureKind } from '@/lib/auth/session-mint';

export type SessionMintStatus = 'ok' | SessionMintFailureKind;
export interface SessionMintResult {
  readonly status: SessionMintStatus;
}

/**
 * Last-known identity token, mirrored out of the Privy SDK's own store by a
 * component that subscribes to it (`useIdentityToken`).
 *
 * This is the PREFERRED token source precisely because reading it costs nothing
 * — no network, no rate-limit budget, no throw. The SDK holds the token anyway
 * (it stores it at login); this just lets us use it without triggering a
 * refresh. Never persisted, logged, or sent anywhere but the session route.
 */
let mirroredIdentityToken: string | null = null;

/** Mirror the SDK's cached identity token. */
export function mirrorIdentityToken(token: string | null | undefined): void {
  mirroredIdentityToken =
    typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * Read a fresh token from the SDK. This MAY hit the rate-limited refresh
 * endpoint, so callers must treat it as expensive. Never throws.
 */
async function readFreshIdentityToken(): Promise<string | null> {
  try {
    const token = await getIdentityToken();
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    // A failed refresh is a failed refresh — never propagate it. The caller
    // reports a fixed kind instead.
    return null;
  }
}

/** POST one token to the session route. Never throws; never reads the body. */
async function postSession(token: string): Promise<SessionMintResult> {
  let res: Response;
  try {
    res = await fetch('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    return { status: 'network' };
  }

  if (res.ok) return { status: 'ok' };
  if (res.status === 403) return { status: 'no-wallet' };
  if (res.status === 503) return { status: 'unavailable' };
  return { status: 'rejected' };
}

/**
 * Mint (or refresh) the signed server session for the current Privy user.
 *
 * At most TWO token reads and TWO requests, and the expensive refresh path only
 * when we have nothing cached or the cached token was refused. Deliberately not
 * a retry loop: the refresh endpoint is rate-limited, and a loop there is what
 * caused the 429s that made this fail in the first place.
 */
export async function mintSession(): Promise<SessionMintResult> {
  const cached = mirroredIdentityToken;

  if (cached) {
    const result = await postSession(cached);
    // Anything other than a refusal is a real answer — return it.
    if (result.status !== 'rejected') return result;

    // The cached token was refused (most likely expired). One refresh is
    // justified; more than one is not.
    const refreshed = await readFreshIdentityToken();
    if (!refreshed || refreshed === cached) return result;
    return postSession(refreshed);
  }

  const fresh = await readFreshIdentityToken();
  if (!fresh) return { status: 'no-token' };
  return postSession(fresh);
}

/** Best-effort server session clear; failures are ignored (cookie TTLs out). */
export async function clearServerSession(): Promise<void> {
  try {
    await fetch('/api/auth/session', {
      method: 'DELETE',
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    // noop — fail-open here is safe: the cookie is not a security boundary on
    // its own (identity is re-verified at every use server-side).
  }
}
