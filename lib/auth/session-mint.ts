/**
 * auth/session-mint — the vocabulary for a FAILED server-session mint.
 *
 * Owns: the closed set of ways POST /api/auth/session can fail, and the fixed
 * user copy for each. Must not import anything — this module is shared by the
 * browser session client and the money-adjacent client flows, so it stays pure.
 *
 * Why this exists (Phase 3): every guarded route answers a missing session with
 * 401, which is indistinguishable from "you are signed out". Collapsing them
 * meant a mint that failed for its own reason (no linked wallet, provider down)
 * was reported to the user as "sign in" — while the wallet pill was showing a
 * connected wallet. That is a false statement about the user's own state, and it
 * hides the real cause. The mint's failure is now carried separately so the copy
 * can be true.
 *
 * Phase 2 (no internals leak): these are fixed strings. No upstream message,
 * status text, or error object ever reaches a user through here.
 */

/** Every way a mint can fail, other than succeeding. */
export type SessionMintFailureKind =
  | 'no-wallet' // 403: authenticated, but no linked Solana wallet to bind
  | 'unavailable' // 503: identity provider (Privy) unreachable
  | 'unauthorized' // no identity token available, or it was rejected
  | 'network'; // the mint request never completed (offline/proxy)

/**
 * Fixed copy for a mint that failed. Distinguishes the causes because the
 * remedy differs: a missing token is "try again", a missing wallet link is
 * "reconnect", and a provider outage is "not your fault, wait".
 */
export function describeSessionMintFailure(kind: SessionMintFailureKind): string {
  if (kind === 'no-wallet') {
    return 'Your wallet is not linked to a sign-in session yet — reconnect it and try again.';
  }
  if (kind === 'unavailable') {
    return 'Sign-in is temporarily unavailable — try again in a moment.';
  }
  if (kind === 'network') {
    return 'We could not reach the server — check your connection and try again.';
  }
  return 'We could not establish your sign-in session — reconnect your wallet and try again.';
}
