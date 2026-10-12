/**
 * auth/session-client — client-side helpers for the server session mint.
 *
 * Owns: calling POST /api/auth/session with a fresh Privy identity token, and
 * clearing the server session on logout. Client-only.
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
 * Backoff between mint attempts (ms).
 *
 * Why the retry exists: the Privy identity token is not reliably readable the
 * instant a SIWS login settles — `getIdentityToken()` can return null for a
 * moment after `loginWithSiws` resolves. A single-shot mint lost that race, and
 * because the caller recorded the attempt as done before it resolved, the user
 * was left with a connected-looking wallet and NO server session for the rest of
 * the page's life (every guarded route then 401s). Bounded: at most 3 attempts,
 * ~1s worst case.
 */
const MINT_BACKOFF_MS = [250, 750] as const;

/**
 * Last-resort identity token, mirrored out of the Privy SDK's own store by a
 * component that already subscribes to it (`useIdentityToken`).
 *
 * Why this exists: the bare `getIdentityToken()` reaches into a module-level
 * Privy client and `await`s a NETWORK refresh (`updateUserAndIdToken`) before it
 * reads the stored token — so it throws (or returns null) purely because that
 * refresh failed, discarding a perfectly usable token from the same store.
 * `mintSession` swallowing that throw is what left a connected wallet with no
 * server session. This is a read-only fallback for exactly that case.
 *
 * Not a new exposure: the value is already resident in the browser (the SDK
 * stores it) and it is never persisted, logged, or sent anywhere but the
 * session route. Held in memory for the life of the page.
 */
let mirroredIdentityToken: string | null = null;

/** Mirror the SDK's cached identity token for use as a last-resort fallback. */
export function mirrorIdentityToken(token: string | null | undefined): void {
  mirroredIdentityToken =
    typeof token === 'string' && token.length > 0 ? token : null;
}

/** One mint attempt. Never throws. */
async function attemptMint(): Promise<SessionMintResult> {
  let token: string | null = null;
  try {
    token = await getIdentityToken();
  } catch {
    token = null;
  }
  // Fall back to the mirrored store value when the refresh path gave us nothing:
  // a failed refresh must not cost a user who is demonstrably signed in.
  if (!token) token = mirroredIdentityToken;
  if (!token) return { status: 'unauthorized' };

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
  return { status: 'unauthorized' };
}

/**
 * Mint (or refresh) the signed server session for the current Privy user.
 *
 * Retries ONLY on `unauthorized` (a missing/not-yet-readable token). A 403
 * (no linked wallet), a 503 (provider down) or a network failure will not change
 * in 250ms, so those return immediately and the caller can report them.
 */
export async function mintSession(): Promise<SessionMintResult> {
  let result = await attemptMint();
  if (result.status !== 'unauthorized') return result;
  for (const wait of MINT_BACKOFF_MS) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    result = await attemptMint();
    if (result.status !== 'unauthorized') return result;
  }
  return result;
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