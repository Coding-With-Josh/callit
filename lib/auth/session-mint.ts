/**
 * auth/session-mint — the vocabulary for a guarded request that could not be
 * authenticated.
 *
 * Owns: the closed set of ways authentication can fail on the client, and the
 * fixed user copy for each. Must not import anything — this module is shared by
 * the browser session client and the money-adjacent client flows, so it stays
 * pure.
 *
 * Why this exists (Phase 3): every guarded route answers a missing session with
 * 401, which is indistinguishable from "you are signed out". Collapsing them
 * meant a failure with its own cause (no token readable, no linked wallet,
 * provider down, session that did not stick) was reported to the user as
 * "sign in" — while the wallet pill showed a connected wallet. That is a false
 * statement about the user's own state, and it hides the real cause.
 *
 * There are exactly two families, and they are genuinely different:
 *   - `SessionMintFailureKind`  — the mint itself did not land.
 *   - `not-persisted`           — the mint reported success, yet the next
 *                                 request was still anonymous.
 *
 * Phase 2 (no internals leak): these are fixed strings. No upstream message,
 * status text, or error object ever reaches a user through here.
 */

/** Every way the session mint can fail, other than succeeding. */
export type SessionMintFailureKind =
  | 'no-token' // no identity token was readable locally; the route was never called
  | 'rejected' // the route was called with a token and refused it (400/401)
  | 'no-wallet' // 403: authenticated, but no linked Solana wallet to bind
  | 'unavailable' // 503: identity provider (Privy) unreachable
  | 'network'; // the mint request never completed (offline/proxy)

/** Every way a guarded request can end up unauthenticated. */
export type SessionFailureKind = SessionMintFailureKind | 'not-persisted';

/**
 * Fixed copy for a failure to authenticate. The kinds are distinguished because
 * the remedy and the blame differ: a missing token is "try again", a missing
 * wallet link is "reconnect", a provider outage is "not your fault, wait", and a
 * session that did not stick is its own thing entirely.
 */
export function describeSessionFailure(kind: SessionFailureKind): string {
  if (kind === 'no-token') {
    return 'We could not read a sign-in token for your wallet — reconnect your wallet and try again.';
  }
  if (kind === 'rejected') {
    return 'The server refused your sign-in token — reconnect your wallet and try again.';
  }
  if (kind === 'no-wallet') {
    return 'Your wallet is not linked to a sign-in session yet — reconnect it and try again.';
  }
  if (kind === 'unavailable') {
    return 'Sign-in is temporarily unavailable — try again in a moment.';
  }
  if (kind === 'network') {
    return 'We could not reach the server — check your connection and try again.';
  }
  return 'Your sign-in session did not stick — reconnect your wallet and try again.';
}
