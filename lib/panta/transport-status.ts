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
