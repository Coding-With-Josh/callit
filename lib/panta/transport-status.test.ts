/**
 * Tests for the Panta transport -> HTTP status mapping.
 *
 * The mapping is security-relevant: it decides whether a failure is reported as
 * the CALLER's problem or the UPSTREAM's. The case that matters is the auth
 * collision — an upstream 401/403 must never be forwarded, because this app's
 * own session guard also answers 401/403 and the client renders those as "you
 * are signed out", which told a signed-in user to sign in.
 */
import { describe, expect, it } from 'vitest';
import { registerErrorStatus, transportErrorStatus } from './transport-status';
import type { PantaTransportError } from './client';

const http = (status: number): PantaTransportError => ({
  kind: 'http',
  status,
  error: { kind: 'unknown', rawCode: `HTTP_${status}`, message: 'upstream failure' },
});

describe('transportErrorStatus', () => {
  it('never forwards an upstream auth rejection as our own 401/403', () => {
    // The lie: Panta rejecting OUR API key read to the user as "sign in".
    expect(transportErrorStatus(http(401))).toBe(502);
    expect(transportErrorStatus(http(403))).toBe(502);
  });

  it('maps upstream 5xx to 502 (bad gateway), not the raw 5xx', () => {
    expect(transportErrorStatus(http(500))).toBe(502);
    expect(transportErrorStatus(http(503))).toBe(502);
  });

  it('preserves the upstream statuses a caller can act on', () => {
    // These carry real meaning for the user (bad input, gone, refused, slow
    // down) and must survive the mapping.
    for (const status of [400, 404, 409, 422, 429]) {
      expect(transportErrorStatus(http(status))).toBe(status);
    }
  });

  it('maps non-HTTP failures without leaking a raw upstream code', () => {
    expect(transportErrorStatus({ kind: 'timeout', timeoutMs: 12000 })).toBe(504);
    expect(transportErrorStatus({ kind: 'config', message: 'no key' })).toBe(503);
    expect(transportErrorStatus({ kind: 'network', message: 'down' })).toBe(502);
    expect(transportErrorStatus({ kind: 'malformed', message: 'bad json' })).toBe(502);
  });

  it('never returns 401 or 403 for any upstream failure', () => {
    // Exhaustive over the shapes a transport error can take: if this ever
    // returns 401/403, an upstream fault becomes indistinguishable from the
    // caller's own missing session.
    const all: readonly PantaTransportError[] = [
      http(400), http(401), http(403), http(404), http(409), http(422),
      http(429), http(500), http(502), http(503), http(504),
      { kind: 'timeout', timeoutMs: 1 },
      { kind: 'config', message: 'x' },
      { kind: 'network', message: 'x' },
      { kind: 'malformed', message: 'x' },
    ];
    for (const error of all) {
      const status = transportErrorStatus(error);
      expect(status).not.toBe(401);
      expect(status).not.toBe(403);
    }
  });
});

describe('registerErrorStatus', () => {
  const known = (status: number, code: string): PantaTransportError => ({
    kind: 'http',
    status,
    error: { kind: 'known', code: code as never, message: 'upstream failure' },
  });

  it('turns a consumed/expired create session into a 409, not a 400', () => {
    // Forwarding 400 here made the client say "that draft isn't valid for a
    // market. Check the fields and try again." — about a request whose only
    // fields are an id and a signature. Verified live: Panta answers
    // 400 CREATE_EXPIRED for a createId that is gone OR already consumed.
    expect(registerErrorStatus(known(400, 'CREATE_EXPIRED'))).toBe(409);
  });

  it('turns a duplicate market into a 409', () => {
    expect(registerErrorStatus(known(400, 'DUPLICATE_MARKET'))).toBe(409);
  });

  it('leaves a submission failure as its own 400 (retryable, not "consumed")', () => {
    // Verified live: a bad signature for a REAL createId returns
    // 400 INVALID_MARKET_PARAMS "unexpected create register failure" — and does
    // NOT consume the createId. It must not be reported as a finished session.
    expect(registerErrorStatus(known(400, 'INVALID_MARKET_PARAMS'))).toBe(400);
  });

  it('does not read an UNKNOWN code as a finished session', () => {
    // Fail closed: a novel code must not be guessed into the "already used"
    // bucket, which would tell the user a market exists when we do not know.
    const unknown: PantaTransportError = {
      kind: 'http',
      status: 400,
      error: { kind: 'unknown', rawCode: 'SOMETHING_NEW', message: 'x' },
    };
    expect(registerErrorStatus(unknown)).toBe(400);
  });

  it('marks a missing transaction as 410 (gone), NOT as a finished session', () => {
    // Verified live: a real createId that was never built answers
    // 404 TX_NOT_FOUND. Panta cannot submit a transaction it does not hold, so
    // nothing was charged and a retry is meaningful (after a rebuild). Reporting
    // the ambiguous 409 here would tell the user a market may exist when it
    // cannot — a false statement in the alarming direction.
    expect(registerErrorStatus(known(404, 'TX_NOT_FOUND'))).toBe(410);
  });

  it('does not give an unrecognised 404 the "nothing was submitted" treatment', () => {
    // Fail closed: only the code actually observed live earns that claim.
    const unknown: PantaTransportError = {
      kind: 'http',
      status: 404,
      error: { kind: 'unknown', rawCode: 'SOMETHING_NEW_404', message: 'x' },
    };
    expect(registerErrorStatus(unknown)).toBe(404);
  });

  it('delegates everything else to the shared mapping', () => {
    expect(registerErrorStatus(known(401, 'UNAUTHORIZED'))).toBe(502);
    expect(registerErrorStatus(known(500, 'INTERNAL_ERROR'))).toBe(502);
    expect(registerErrorStatus({ kind: 'timeout', timeoutMs: 1 })).toBe(504);
    expect(registerErrorStatus({ kind: 'network', message: 'down' })).toBe(502);
    // A 409 upstream is already the right shape; only 400 needs re-reading.
    expect(registerErrorStatus(known(409, 'DUPLICATE_MARKET'))).toBe(409);
  });

  it('never returns 401 or 403 for any register failure', () => {
    const all: readonly PantaTransportError[] = [
      known(400, 'CREATE_EXPIRED'),
      known(400, 'DUPLICATE_MARKET'),
      known(400, 'INVALID_MARKET_PARAMS'),
      known(404, 'TX_NOT_FOUND'),
      known(401, 'UNAUTHORIZED'),
      known(403, 'FORBIDDEN'),
      known(500, 'INTERNAL_ERROR'),
      { kind: 'timeout', timeoutMs: 1 },
      { kind: 'config', message: 'x' },
      { kind: 'network', message: 'x' },
      { kind: 'malformed', message: 'x' },
    ];
    for (const error of all) {
      expect(registerErrorStatus(error)).not.toBe(401);
      expect(registerErrorStatus(error)).not.toBe(403);
    }
  });
});
