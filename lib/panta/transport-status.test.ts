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
import { transportErrorStatus } from './transport-status';
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
