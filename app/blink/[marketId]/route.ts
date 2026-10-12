/**
 * /blink/[marketId] — the Solana Action endpoint for one primary market.
 *
 * Owns: the HTTP translation only. `GET` renders the Action metadata (preset
 * Back YES / Back NO buttons), `POST` returns the unsigned transaction a wallet
 * signs, `OPTIONS` answers preflight. All decision-making lives in
 * `lib/blink/*`, so the gates are unit-tested without a framework in the loop.
 *
 * WHY THERE IS NO AUTH HERE (Phase 1, complete mediation): a Blink is fetched
 * cross-origin by a wallet or a social client with no cookie jar. Every response
 * therefore advertises `Access-Control-Allow-Origin: *` and deliberately omits
 * `Access-Control-Allow-Credentials`, so a browser will not attach cookies to
 * these requests. This route must never read the session — not for
 * authorisation, which would be meaningless here, and not for convenience,
 * because a session identity leaking into a public builder is exactly how an
 * unauthenticated endpoint starts making authenticated-looking decisions. The
 * authority for a Blink is the wallet signature the user produces after seeing
 * the transaction, and nothing else.
 *
 * NOTHING HERE IS INHERITED: the market-id pattern, the preset allowlist, the
 * account schema, the chain gate, the rate budget, the echo cross-check and the
 * signer gate are each applied at their own point of use, below or in the
 * modules this route calls.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { actionErrorSchema, actionPostResponseSchema } from '@/types';
import { pantaClientFromEnv } from '@/lib/panta/client';
import { MARKET_ID_PATTERN } from '@/lib/panta/read-adapters';
import { transportErrorMessage, transportErrorStatus } from '@/lib/panta/route-helpers';
import { actionHeaders, BLINK_TRADING_ENABLED } from '@/lib/blink/action-headers';
import { admit, metadataBuckets } from '@/lib/blink/limits';
import { loadBlinkMarket } from '@/lib/blink/market';
import { buildActionMetadata } from '@/lib/blink/metadata';
import {
  defaultBlinkOrderDeps,
  runBlinkOrder,
  type BlinkOrderFailure,
} from '@/lib/blink/order';
import type { BlinkParamError } from '@/lib/blink/params';
import { consumeRateLimit } from '@/lib/ledger/rate-limit';

type RouteContext = { params: Promise<{ marketId: string }> };

/** Safe copy for each way an order's query parameters can be rejected. */
const INVALID_ORDER_COPY: Readonly<Record<BlinkParamError, string>> = {
  'missing side': 'A valid side (yes or no) is required.',
  'invalid side': 'A valid side (yes or no) is required.',
  'missing amount': 'An amount is required.',
  'unsupported amount': 'That amount is not offered by this Blink.',
};

/**
 * Hard cap on the POST body. The body is `{"account":"<44 chars>"}` — about 60
 * bytes — so this is generous by two orders of magnitude.
 *
 * Phase 3 (T6 request-body flood): the App Router does not size-cap a route
 * handler's body, so an unbounded `req.json()` is a memory/CPU DoS available to
 * anyone. `Content-Length` cannot be trusted on its own (it is attacker-supplied
 * and absent on a chunked body), so the declared value is a cheap early reject
 * and the ACTUAL decoded length is re-checked afterwards.
 */
const MAX_BLINK_BODY_BYTES = 2048;

type BodyRead =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'unreadable' };

/** Read the request body, refusing anything over the cap. */
async function readBoundedBody(req: NextRequest): Promise<BodyRead> {
  const declared = req.headers.get('content-length');
  if (declared !== null) {
    const bytes = Number(declared);
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > MAX_BLINK_BODY_BYTES) {
      return { kind: 'too-large' };
    }
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { kind: 'unreadable' };
  }
  // The header can be absent or lie; the real length decides.
  if (text.length > MAX_BLINK_BODY_BYTES) return { kind: 'too-large' };
  return { kind: 'ok', text };
}

/** A Solana Actions error response, carrying the full CORS header set. */
function actionError(status: number, message: string): NextResponse {
  return NextResponse.json(actionErrorSchema.parse({ message }), {
    status,
    headers: actionHeaders({ 'Cache-Control': 'no-store' }),
  });
}

/** Fixed copy per failure kind. Never interpolates attacker input. */
function orderFailureResponse(failure: BlinkOrderFailure): NextResponse {
  switch (failure.kind) {
    case 'trading-disabled':
      return actionError(403, 'Blink trading is not enabled on this deployment.');
    case 'invalid-order':
      // Does NOT echo the rejected value back — the response must not become a
      // reflection surface for whatever a caller sent.
      return actionError(400, INVALID_ORDER_COPY[failure.reason]);
    case 'invalid-account':
      return actionError(400, 'A valid Solana account is required.');
    case 'market-not-found':
      return actionError(404, 'Market not found.');
    case 'fixture-market':
      return actionError(403, 'This is a demo market. No funds can move.');
    case 'market-not-buyable':
      return actionError(409, 'This market is not open for primary buying.');
    case 'rate-limited': {
      const response = actionError(429, 'Too many requests. Try again shortly.');
      response.headers.set('Retry-After', String(failure.retryAfterSec));
      return response;
    }
    case 'unavailable':
      return actionError(503, 'Blinking this market is temporarily unavailable.');
    case 'upstream':
      // An upstream failure is reported with the same status/message the rest of
      // the app uses, but in an Actions-shaped body WITH CORS headers — a client
      // whose preflight passed must be able to read the error.
      return failure.transport !== null
        ? actionError(transportErrorStatus(failure.transport), transportErrorMessage(failure.transport))
        : actionError(502, 'The order could not be prepared. Try again.');
    case 'unbuildable':
      return actionError(502, 'The order could not be prepared. Try again.');
  }
}

/** Preflight. Answered before any budget is spent: a preflight is not a request. */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 200, headers: actionHeaders() });
}

/**
 * The Action metadata. Public and cacheable-adjacent: the response is identical
 * for every caller and carries no user data, so a short public cache is safe.
 */
export async function GET(
  req: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { marketId } = await params;

  // Perimeter. A non-slug id is "no market here", never a 400 that confirms the
  // id space (Phase 3: enumeration).
  if (!MARKET_ID_PATTERN.test(marketId)) {
    return actionError(404, 'Market not found.');
  }

  // Budget before the market read. Fail closed on an unavailable limiter.
  const admission = await admit(consumeRateLimit, metadataBuckets(req.headers));
  if (admission.kind === 'limited') {
    const response = actionError(429, 'Too many requests. Try again shortly.');
    response.headers.set('Retry-After', String(admission.retryAfterSec));
    return response;
  }
  if (admission.kind === 'unavailable') {
    return actionError(503, 'Blinking this market is temporarily unavailable.');
  }

  const fixture = await loadBlinkMarket(marketId);
  if (fixture === null) return actionError(404, 'Market not found.');

  return NextResponse.json(buildActionMetadata(fixture), {
    status: 200,
    headers: actionHeaders({ 'Cache-Control': 'public, max-age=30' }),
  });
}

/**
 * Build the transaction for the chosen preset.
 *
 * Order matters: chain gate, then id pattern, then the Panta client, then the
 * bounded body — so an unconfigured deploy or a devnet build is refused before
 * we parse anything a caller sent.
 */
export async function POST(
  req: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { marketId } = await params;

  // Chain gate first: a build that is not mainnet must never assemble a
  // transaction, whatever else is true about this request.
  if (!BLINK_TRADING_ENABLED) {
    return orderFailureResponse({ kind: 'trading-disabled' });
  }

  if (!MARKET_ID_PATTERN.test(marketId)) {
    return actionError(404, 'Market not found.');
  }

  const client = pantaClientFromEnv();
  if (!client.ok) {
    // No Panta key: nothing to build with. Fail closed rather than 500.
    return orderFailureResponse({ kind: 'unavailable', detail: 'Panta is not configured' });
  }

  const body = await readBoundedBody(req);
  if (body.kind === 'too-large') {
    return actionError(413, 'Request body is too large.');
  }
  if (body.kind === 'unreadable') {
    return actionError(400, 'Request body could not be read.');
  }

  const outcome = await runBlinkOrder(
    {
      marketId,
      searchParams: req.nextUrl.searchParams,
      bodyText: body.text,
      headers: req.headers,
    },
    defaultBlinkOrderDeps(client.value),
  );

  if (!outcome.ok) return orderFailureResponse(outcome.failure);

  // The response is validated against the Actions POST schema before it leaves,
  // and carries no `links.next`: slice 1 ships no callback route, so shipping a
  // URL to one would be a promise we cannot keep.
  return NextResponse.json(
    actionPostResponseSchema.parse({
      transaction: outcome.transaction,
      message: outcome.message,
    }),
    { status: 200, headers: actionHeaders({ 'Cache-Control': 'no-store' }) },
  );
}
