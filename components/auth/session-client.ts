/**
 * auth/session-client — client-side helpers for the server session mint.
 *
 * Owns: calling POST /api/auth/session with a Privy ACCESS token, and clearing
 * the server session on logout. Client-only.
 *
 * WHY THE ACCESS TOKEN (the bug this fixes): the identity token's ONLY source is
 * Privy's rate-limited `GET /api/v1/users/me`. `getIdentityToken()` force-calls
 * that endpoint, and when its response carries no identity token the SDK calls
 * `clearIdentityToken()` — it does not merely return null, it wipes any token it
 * had. So on a rate-limited account the mint failed with `no-token` BEFORE it
 * ever reached our server, while the user was demonstrably signed in. The access
 * token is stored by the SDK at login and refreshed by the SDK itself, so it is
 * always readable; and the server's `verifyAuthToken` accepts it (it pins
 * issuer/audience/algorithm against the app verification key and does not check
 * a token-TYPE claim). Presenting the access token is the SDK's own documented
 * path: "use this token to authorize requests sent from your frontend".
 *
 * COST MODEL (learned the hard way): a token read is a LOCAL read while the
 * token is still active — the SDK refreshes only when it is expired or about to
 * expire, and that refresh goes to the session endpoint, NOT `/users/me`. At
 * most TWO reads and TWO requests per mint. Deliberately no retry loop: a loop
 * against a rate-limited endpoint is what caused the 429s in the first place.
 *
 * Phase 2 (dependency down): a 503 from the route means Privy is unreachable; we
 * surface `unavailable` and never mint. An existing signed cookie is unchanged
 * and stays valid until its TTL, which is safe (it encodes a previously-verified
 * identity).
 */
'use client';

import type { SessionMintFailureKind } from '@/lib/auth/session-mint';

export type SessionMintStatus = 'ok' | SessionMintFailureKind;
export interface SessionMintResult {
  readonly status: SessionMintStatus;
}

/**
 * Last-known Privy access token, mirrored out of a component that can read it
 * (`usePrivy().getAccessToken()`).
 *
 * This is the PREFERRED token source precisely because reading it costs nothing
 * once it is here — no network, no rate-limit budget, no throw. Never persisted,
 * logged, or sent anywhere but the session route.
 */
let mirroredAccessToken: string | null = null;

/** Mirror the SDK's Privy access token. */
export function mirrorAccessToken(token: string | null | undefined): void {
  mirroredAccessToken =
    typeof token === 'string' && token.length > 0 ? token : null;
}

/**
 * A live getter for the Privy access token, registered by a component that can
 * call `usePrivy().getAccessToken()`.
 *
 * Registered rather than imported because the access token is only reachable
 * through React: the SDK's module-level `getAccessToken` export is the CUSTOMER
 * access token, which is issued by the developer's own auth system (not Privy)
 * and would be correctly rejected by our verifier. Registering keeps this module
 * free of React while still giving the mint a real token source.
 */
type AccessTokenProvider = () => Promise<string | null>;
let accessTokenProvider: AccessTokenProvider | null = null;

/** Register (or clear, with null) the live access-token getter. */
export function registerAccessTokenProvider(
  provider: AccessTokenProvider | null,
): void {
  accessTokenProvider = provider;
}

/**
 * Read the current access token: the mirrored value first (free), then the live
 * getter. This MAY refresh through the SDK, but only when the token is expired —
 * never through `/users/me`. Never throws.
 */
async function readAccessToken(): Promise<string | null> {
  if (mirroredAccessToken) return mirroredAccessToken;
  // No live getter means no token source at all: report exactly that rather
  // than pretending a network failure occurred.
  if (!accessTokenProvider) return null;
  try {
    const token = await accessTokenProvider();
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    // A failed read is a failed read — never propagate it. The caller reports a
    // fixed kind instead.
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
 * At most TWO token reads and TWO requests, and the second request only when the
 * first token was refused. Not a retry loop.
 */
export async function mintSession(): Promise<SessionMintResult> {
  const token = await readAccessToken();
  if (!token) return { status: 'no-token' };

  const result = await postSession(token);
  // Anything other than a refusal is a real answer — return it.
  if (result.status !== 'rejected') return result;

  // The token was refused (most likely expired). ONE refresh through the live
  // getter is justified; more than one is not. When there is no live getter we
  // cannot refresh, so the refusal stands.
  if (!accessTokenProvider) return result;
  let refreshed: string | null;
  try {
    refreshed = await accessTokenProvider();
  } catch {
    return result;
  }
  if (!refreshed || refreshed === token) return result;
  return postSession(refreshed);
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
