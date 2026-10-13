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
import {
  isUnpriceableQuoteError,
  quoteErrorStatus,
  registerErrorStatus,
  submitErrorStatus,
  transportErrorStatus,
} from './transport-status';
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

  it('marks a transaction Panta cannot see yet as TRANSIENT (503), not as terminal', () => {
    // Observed live: a real createId answers 404 TX_NOT_FOUND. Register REPORTS a
    // transaction that has already been broadcast by the wallet, and Panta
    // indexes from the chain — so this is what a visibility lag looks like, not a
    // verdict about money. It must be retryable (503), because the earlier
    // mapping (410, "nothing was submitted") was a lie in the dangerous
    // direction: the transaction IS on-chain and the fee HAS moved, and a user
    // told otherwise is being invited to submit a second market.
    expect(registerErrorStatus(known(404, 'TX_NOT_FOUND'))).toBe(503);
  });

  it('does not give an unrecognised 404 the "not visible yet" treatment', () => {
    // Fail closed: only the code actually observed live earns that reading.
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

describe('submitErrorStatus (the buy report)', () => {
  const known = (status: number, code: string): PantaTransportError => ({
    kind: 'http',
    status,
    error: { kind: 'known', code: code as never, message: 'upstream failure' },
  });

  it('marks a transaction Panta cannot see yet as TRANSIENT (503)', () => {
    // The buy report has the same visibility lag as register: the wallet has
    // already submitted the order, so a 404 TX_NOT_FOUND says "not indexed yet",
    // not "nothing happened". It must be retryable with the SAME signature,
    // which is why the client's report loop retries 503 only.
    expect(submitErrorStatus(known(404, 'TX_NOT_FOUND'))).toBe(503);
  });

  it('turns a stale-quote refusal into a 409, not a 400', () => {
    // Verified live (2026-10-12): POST /primaryordersubmit/ with an unknown or
    // expired order answers 400 {"code":"QUOTE_EXPIRED"}. Forwarding that as a
    // 400 made the client say "that order isn't valid. Check the amount and try
    // again." — about a body whose only fields are an id and a signature, at a
    // stage where the wallet has ALREADY submitted the order. The amount was
    // never the problem, and the order may already be on-chain.
    expect(submitErrorStatus(known(400, 'QUOTE_EXPIRED'))).toBe(409);
  });

  it('does not invent buy-specific meaning for unrecognised codes', () => {
    expect(submitErrorStatus(known(400, 'INVALID_MARKET_PARAMS'))).toBe(400);
    // A register-only code is not special here: fail closed, no guessing.
    expect(submitErrorStatus(known(400, 'DUPLICATE_MARKET'))).toBe(400);
    const unknown: PantaTransportError = {
      kind: 'http',
      status: 404,
      error: { kind: 'unknown', rawCode: 'SOMETHING_NEW_404', message: 'x' },
    };
    expect(submitErrorStatus(unknown)).toBe(404);
  });

  it('never returns 401 or 403 for any report failure', () => {
    const all: readonly PantaTransportError[] = [
      known(404, 'TX_NOT_FOUND'),
      known(400, 'QUOTE_EXPIRED'),
      known(400, 'INVALID_MARKET_PARAMS'),
      known(401, 'UNAUTHORIZED'),
      known(403, 'FORBIDDEN'),
      known(500, 'INTERNAL_ERROR'),
      { kind: 'timeout', timeoutMs: 1 },
      { kind: 'config', message: 'x' },
      { kind: 'network', message: 'x' },
      { kind: 'malformed', message: 'x' },
    ];
    for (const error of all) {
      expect(submitErrorStatus(error)).not.toBe(401);
      expect(submitErrorStatus(error)).not.toBe(403);
    }
  });
});

describe('quoteErrorStatus (the buy quote)', () => {
  const known = (status: number, code: string): PantaTransportError => ({
    kind: 'http',
    status,
    error: { kind: 'known', code: code as never, message: 'upstream failure' },
  });
  /** A 400 whose body names the offending field(s), the serializer's own shape. */
  const fielded = (
    fields: Readonly<Record<string, readonly string[]>>,
  ): PantaTransportError => ({
    kind: 'http',
    status: 400,
    error: { kind: 'known', code: 'INVALID_MARKET_PARAMS', message: 'x', fields },
  });

  it('keeps the ONE code the amount copy is true for as a 400', () => {
    // `AMOUNT_TOO_SMALL` is its own documented code and the only quote failure
    // that is really about the amount. It must stay the caller's problem.
    expect(quoteErrorStatus(known(400, 'AMOUNT_TOO_SMALL'))).toBe(400);
    expect(quoteErrorStatus(fielded({ amountUsdc: ['too small'] }))).toBe(400);
  });

  it('turns a graduated market into a 409, not a "bad order" 400', () => {
    // Verified live (2026-10-13): the market that graduated between load and
    // quote answers 400 MARKET_NOT_IN_PRIMARY. Forwarded verbatim it read to the
    // user as "check the amount" — about an order whose operands were fine.
    expect(quoteErrorStatus(known(400, 'MARKET_NOT_IN_PRIMARY'))).toBe(409);
  });

  it('turns a missing market into a 404', () => {
    expect(quoteErrorStatus(known(400, 'MARKET_NOT_FOUND'))).toBe(404);
  });

  it('reports a BARE INVALID_MARKET_PARAMS as transient (503), not as the user\'s error', () => {
    // The bug the user hit. Live evidence: the same market, side and amount
    // answered 200 nine times and this bare body once, while a market with no
    // on-chain price answers it every time. It is "Panta could not price this
    // market on THIS request" — transient, and the adapter re-rolls it before
    // the caller ever sees it.
    expect(quoteErrorStatus(known(400, 'INVALID_MARKET_PARAMS'))).toBe(503);
    expect(isUnpriceableQuoteError(known(400, 'INVALID_MARKET_PARAMS'))).toBe(true);
  });

  it('does not call a FIELD error unpriceable', () => {
    // The distinguishing signal is the serializer's own `field`/`fields`: a
    // body that names a bad field IS the caller's problem and must not be
    // re-rolled (a bounded retry of a genuinely wrong request is wasted budget
    // and a delay before the honest copy).
    expect(isUnpriceableQuoteError(fielded({ amountUsdc: ['invalid'] }))).toBe(false);
    expect(
      isUnpriceableQuoteError({
        kind: 'http',
        status: 400,
        error: { kind: 'known', code: 'INVALID_MARKET_PARAMS', message: 'x', field: 'amountUsdc' },
      }),
    ).toBe(false);
    expect(
      quoteErrorStatus({
        kind: 'http',
        status: 400,
        error: { kind: 'known', code: 'INVALID_MARKET_PARAMS', message: 'x', field: 'amountUsdc' },
      }),
    ).toBe(400);
  });

  it('never retries a failure that is not that one code', () => {
    for (const error of [
      known(400, 'AMOUNT_TOO_SMALL'),
      known(400, 'MARKET_NOT_IN_PRIMARY'),
      known(400, 'MARKET_NOT_FOUND'),
      known(401, 'UNAUTHORIZED'),
      known(429, 'RATE_LIMITED'),
      known(500, 'INTERNAL_ERROR'),
      { kind: 'timeout', timeoutMs: 1 },
      { kind: 'network', message: 'down' },
      { kind: 'malformed', message: 'bad json' },
      { kind: 'config', message: 'no key' },
    ] as readonly PantaTransportError[]) {
      expect(isUnpriceableQuoteError(error)).toBe(false);
    }
  });

  it('does not read an UNKNOWN code as the transient case', () => {
    // Fail closed: an unrecognised code is not guessed into "retry it".
    const unknown: PantaTransportError = {
      kind: 'http',
      status: 400,
      error: { kind: 'unknown', rawCode: 'SOMETHING_NEW', message: 'x' },
    };
    expect(isUnpriceableQuoteError(unknown)).toBe(false);
    expect(quoteErrorStatus(unknown)).toBe(400);
  });

  it('delegates everything else to the shared mapping', () => {
    expect(quoteErrorStatus(known(401, 'UNAUTHORIZED'))).toBe(502);
    expect(quoteErrorStatus(known(403, 'FORBIDDEN'))).toBe(502);
    expect(quoteErrorStatus(known(429, 'RATE_LIMITED'))).toBe(429);
    expect(quoteErrorStatus(known(500, 'INTERNAL_ERROR'))).toBe(502);
    expect(quoteErrorStatus({ kind: 'timeout', timeoutMs: 1 })).toBe(504);
    expect(quoteErrorStatus({ kind: 'config', message: 'no key' })).toBe(503);
    expect(quoteErrorStatus({ kind: 'network', message: 'down' })).toBe(502);
  });

  it('never returns 401 or 403 for any quote failure', () => {
    const all: readonly PantaTransportError[] = [
      known(400, 'AMOUNT_TOO_SMALL'),
      known(400, 'MARKET_NOT_IN_PRIMARY'),
      known(400, 'MARKET_NOT_FOUND'),
      fielded({ amountUsdc: ['invalid'] }),
      known(401, 'UNAUTHORIZED'),
      known(403, 'FORBIDDEN'),
      known(500, 'INTERNAL_ERROR'),
      { kind: 'timeout', timeoutMs: 1 },
      { kind: 'config', message: 'x' },
      { kind: 'network', message: 'x' },
      { kind: 'malformed', message: 'x' },
    ];
    for (const error of all) {
      expect(quoteErrorStatus(error)).not.toBe(401);
      expect(quoteErrorStatus(error)).not.toBe(403);
    }
  });
});
