/**
 * panta/transport-status — the HTTP status a Panta transport error becomes.
 *
 * Pure and Next-free on purpose. The mapping is security-relevant: it decides
 * whether a failure is reported as the CALLER's problem or the UPSTREAM's, so it
 * is unit-tested directly rather than only through a route.
 *
 * Phase 3 (auth-status collision): this app's own session guard answers 401/403,
 * and the client renders those as "you are signed out". An UPSTREAM 401/403
 * means Panta rejected OUR credentials — a server-side integration fault that no
 * action by the user can fix. Forwarding it verbatim made the client tell a
 * signed-in user to sign in (a false statement about their own state, and an
 * unactionable one). Upstream auth failures therefore become 502.
 */
import type { PantaTransportError } from './client';

export function transportErrorStatus(error: PantaTransportError): number {
  if (error.kind === 'http') {
    // Never let an upstream auth rejection share a status code with our own.
    if (error.status === 401 || error.status === 403) return 502;
    return error.status >= 500 ? 502 : error.status;
  }
  if (error.kind === 'timeout') return 504;
  if (error.kind === 'config') return 503;
  return 502;
}

/** The Panta error CODE, whether or not it is in the known set. Never the message. */
function pantaCodeOf(error: PantaTransportError): string | null {
  if (error.kind !== 'http') return null;
  // An unrecognised code is preserved as `rawCode`; reading it is what lets this
  // fail CLOSED without failing BLIND (see the unknown-code test).
  return error.error.kind === 'known' ? error.error.code : error.error.rawCode;
}

/**
 * The status for a REGISTER transport error.
 *
 * Register is the one create step whose upstream 4xx is not a complaint about
 * the caller's fields — its body is only `{ createId, signature }`, so there are
 * no fields to complain about. The shared mapping would forward those verbatim
 * to a client that renders 400 as "That draft isn't valid for a market. Check the
 * fields and try again." — at a stage where the draft is settled and the
 * transaction is already on-chain. That is a false statement about the user's
 * draft and it points at something that is not the problem.
 *
 * What matters here is a fact about MONEY: whether a market may already exist.
 * The closed, documented error CODE is what tells the cases apart (verified
 * against the live API on 2026-10-12). Only the code is read — never the
 * free-text message:
 *
 *   CREATE_EXPIRED   (400) "createId not found or already consumed"
 *   DUPLICATE_MARKET (400) a market for this claim already exists
 *   TX_NOT_FOUND     (404) Panta cannot see the transaction yet
 *
 * The first two mean the session is FINISHED, and the answer Panta gives for
 * "never submitted" and "already registered" is the same one — so it is unknown
 * whether a charge occurred, and it becomes 409 (a conflict with existing state,
 * not a bad request).
 *
 * TX_NOT_FOUND carries NO verdict about money, and this mapping was corrected
 * once the missing broadcast step was implemented (register REQUIRES the
 * transaction to be visible on-chain, which is why every register used to return
 * exactly this). Since the transaction has already been broadcast by then, this
 * code is what a visibility lag looks like, not a failure: Panta indexes from the
 * chain, so a report sent immediately after the send legitimately arrives before
 * Panta can see it, and the correct response is to report it as TRANSIENT (503)
 * for the caller to retry with the SAME signature.
 *
 * The previous mapping sent it as 410 "nothing was submitted", which was a lie in
 * the dangerous direction: the transaction IS on-chain, the fee HAS moved, and a
 * user told otherwise is being invited to submit a second market.
 *
 * Everything else falls through to the shared mapping (upstream auth -> 502, 5xx
 * -> 502, timeout -> 504, a submission failure -> its own 400).
 */
export function registerErrorStatus(error: PantaTransportError): number {
  if (error.kind === 'http') {
    const code = pantaCodeOf(error);
    if (
      error.status === 400 &&
      (code === 'CREATE_EXPIRED' || code === 'DUPLICATE_MARKET')
    ) {
      return 409;
    }
    // Transient visibility, or a 404 we do not recognise (which falls through to
    // the shared mapping and stays a 404 — fail closed without failing blind).
    if (error.status === 404 && code === 'TX_NOT_FOUND') return 503;
  }
  return transportErrorStatus(error);
}
