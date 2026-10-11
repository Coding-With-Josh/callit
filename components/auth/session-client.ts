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

export type SessionMintStatus =
  | 'ok'
  | 'no-wallet' // 403: authenticated but no linked Solana wallet
  | 'unavailable' // 503: identity provider down
  | 'unauthorized' // 400/401 or no token available
  | 'network'; // fetch failed (offline / proxy)

export interface SessionMintResult {
  readonly status: SessionMintStatus;
}

/** Mint (or refresh) the signed server session for the current Privy user. */
export async function mintSession(): Promise<SessionMintResult> {
  let token: string | null = null;
  try {
    token = await getIdentityToken();
  } catch {
    return { status: 'unauthorized' };
  }
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