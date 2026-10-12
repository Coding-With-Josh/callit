/**
 * blink/order — the Blink buy POST, from a preset intent to a signed-ready
 * transaction, fail-closed at every step.
 *
 * Owns: the ordered gate sequence (chain -> perimeter -> budget -> market ->
 * quote -> echo cross-check -> assemble -> record) and the mapping of every
 * failure to a typed value.
 * Must not import: React or Next. `Header`/`URLSearchParams` are standard web
 * types, so this module is unit-testable with no framework in the loop.
 *
 * WHY THIS FILE IS PARANOID (Phase 1/3): the POST is unauthenticated,
 * cross-origin, and its output is handed to a stranger's wallet which then signs
 * a REAL mainnet transfer of USDC. There is no session, no cookie and no CSRF
 * token to lean on — the only authority is the signature the user's own wallet
 * produces AFTER seeing this transaction. So the rules are:
 *
 *   1. The order's operands come from the server-baked href, never the body.
 *      The body contributes `account` and nothing else (Phase 3: T1).
 *   2. Every gate is checked here, at the point of use. Nothing is inherited
 *      from a route, an upstream service, or a previous gate (complete
 *      mediation).
 *   3. A failure NEVER returns a transaction. An unrecorded transaction is not
 *      returned either — if we cannot write the row, the order does not ship.
 *   4. We never mutate Panta's instructions (types/tx.ts hard rule).
 */

import {
  actionPostRequestSchema,
  requirePrimaryMarket,
  serializeAttribution,
  unixSeconds,
  usdcDecimalToBaseUnits,
  walletAddressSchema,
  type PantaTransaction,
  type WalletAddress,
} from '@/types';
import { PantaCallError, type PantaClient, type PantaTransportError } from '@/lib/panta/client';
import { buildBuyOrder, requestBuyQuote } from '@/lib/panta/buy-adapters';
import {
  assembleUnsignedTransaction,
  type AssembleError,
} from '@/lib/solana/assemble';
import {
  consumeRateLimit,
  type ConsumeRateLimitArgs,
  type RateLimitOutcome,
} from '@/lib/ledger/rate-limit';
import {
  insertPendingOrder,
  type PendingOrderRecord,
} from '@/lib/ledger/pending-orders';
import type { MarketFixture } from '@/lib/market-fixtures';
import { BLINK_TRADING_ENABLED } from './action-headers';
import { admit, buildBuckets } from './limits';
import { sanitizeCopyWithBadge } from './metadata';
import { parseBlinkOrderParams, type BlinkParamError, type BlinkOrderParams } from './params';

/** Cap on the wallet-facing `message` copy. The spec sets no limit; we do. */
export const BLINK_MESSAGE_MAX = 200;

/** Everything the POST takes from an untrusted request. */
export interface BlinkOrderInput {
  /** The untrusted path segment. Pattern-checked by the route before this runs. */
  readonly marketId: string;
  /** The action URL's query string — the ONLY source of side and amount. */
  readonly searchParams: URLSearchParams;
  /** The raw request body, already size-capped by the route, or null. */
  readonly bodyText: string | null;
  /** Request headers, read only for the per-IP rate-limit key. */
  readonly headers: Headers;
}

/**
 * The collaborators a Blink order needs. Injected so the gate sequence is
 * testable offline and so the route owns nothing but HTTP translation.
 */
export interface BlinkOrderDeps {
  readonly client: PantaClient;
  readonly loadMarket: (marketId: string) => Promise<MarketFixture | null>;
  readonly recordOrder: (record: PendingOrderRecord) => Promise<void>;
  readonly consumeLimit: (args: ConsumeRateLimitArgs) => Promise<RateLimitOutcome>;
  /** Injectable clock (unix seconds). */
  readonly nowSec: () => number;
}

/**
 * Why a Blink order did not produce a transaction. Every variant is a distinct
 * HTTP outcome; the route maps them and nothing else.
 */
export type BlinkOrderFailure =
  | { readonly kind: 'trading-disabled' }
  | { readonly kind: 'invalid-order'; readonly reason: BlinkParamError }
  | { readonly kind: 'invalid-account' }
  | { readonly kind: 'market-not-found' }
  | { readonly kind: 'fixture-market' }
  | { readonly kind: 'market-not-buyable'; readonly reason: string }
  | { readonly kind: 'rate-limited'; readonly retryAfterSec: number }
  /** Our own infrastructure (limiter, ledger, attribution) is not usable. */
  | { readonly kind: 'unavailable'; readonly detail: string }
  /** Panta answered, but not acceptably. `transport` is set for a transport-level failure. */
  | { readonly kind: 'upstream'; readonly transport: PantaTransportError | null; readonly detail: string }
  /** Panta's instructions could not be safely compiled into a transaction. */
  | { readonly kind: 'unbuildable'; readonly reason: AssembleError['kind'] };

export type BlinkOrderOutcome =
  | {
      readonly ok: true;
      readonly transaction: PantaTransaction;
      readonly message: string;
    }
  | { readonly ok: false; readonly failure: BlinkOrderFailure };

function fail(failure: BlinkOrderFailure): BlinkOrderOutcome {
  return { ok: false, failure };
}

/**
 * Read `{ account }` from the raw body.
 *
 * Phase 3 (T1, T8): this is the entire perimeter. `actionPostRequestSchema`
 * deliberately tolerates unknown properties — the spec REQUIRES clients be able
 * to send extra fields, and rejecting them would break conforming clients — so
 * the shape is "allow and ignore" rather than "allow-list and reject". What
 * makes that safe is that nothing else is read: no other key, from no other
 * request part, can influence the order. The account is then validated as a
 * Solana address (base58, exactly 32 bytes) before anything else touches it.
 */
function parseAccount(bodyText: string | null): WalletAddress | null {
  if (bodyText === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const body = actionPostRequestSchema.safeParse(json);
  if (!body.success) return null;
  const wallet = walletAddressSchema.safeParse(body.data.account);
  return wallet.success ? wallet.data : null;
}

/** Wallet-facing copy. Badge-safe, bounded, and never built from request input. */
function orderMessage(fixture: MarketFixture, params: BlinkOrderParams): string {
  const side = params.side === 'yes' ? 'YES' : 'NO';
  return sanitizeCopyWithBadge(
    `Back ${side} with ${params.amountLabel} USDC on "${fixture.market.title}". ` +
      'Your wallet shows the fee before you sign.',
    BLINK_MESSAGE_MAX,
  );
}

/**
 * Run the whole Blink build. Total: every failure is a typed value, and no
 * failure path returns a transaction.
 */
export async function runBlinkOrder(
  input: BlinkOrderInput,
  deps: BlinkOrderDeps,
): Promise<BlinkOrderOutcome> {
  // Gate 0 — chain (Phase 2, fail-closed config). A build that is not mainnet
  // must never assemble a transaction, because the wallet would sign REAL USDC
  // against a chain whose state we cannot vouch for. Checked here as well as in
  // the route so no future caller can reach the assembly step without it.
  if (!BLINK_TRADING_ENABLED) {
    return fail({ kind: 'trading-disabled' });
  }

  // Gate 1 — perimeter: the order intent, sourced ONLY from the query string and
  // matched against a closed allowlist (Phase 3: T1 amount/side contest).
  const params = parseBlinkOrderParams(input.searchParams);
  if (!params.ok) return fail({ kind: 'invalid-order', reason: params.error });
  const order = params.value;

  // Gate 2 — perimeter: the signer/payer account.
  const account = parseAccount(input.bodyText);
  if (account === null) return fail({ kind: 'invalid-account' });

  // Gate 3 — budget, before any upstream work (Phase 2/3: DoS). Per-IP fairness
  // then the app-wide cap; `unavailable` denies, it never means "no limit".
  const admission = await admit(deps.consumeLimit, buildBuckets(input.headers));
  if (admission.kind === 'limited') {
    return fail({ kind: 'rate-limited', retryAfterSec: admission.retryAfterSec });
  }
  if (admission.kind === 'unavailable') {
    return fail({ kind: 'unavailable', detail: 'rate limiter unavailable' });
  }

  // Gate 4 — the market. `loadBlinkMarket` is catalog-gated, so an unknown id
  // costs no upstream read (Phase 3: T5 upstream amplification).
  const fixture = await deps.loadMarket(input.marketId);
  if (fixture === null) return fail({ kind: 'market-not-found' });

  // Gate 5 — provenance, BEFORE phase. A fixture's phase is `primary`, so a
  // phase-only check would happily quote a demo market and hand back a
  // transaction for a market that does not exist on-chain (Phase 3: T4).
  if (fixture.provenance === 'fixture') return fail({ kind: 'fixture-market' });

  // Gate 6 — phase. Only a primary market can be bought into.
  const primary = requirePrimaryMarket(fixture.market);
  if (!primary.ok) {
    return fail({ kind: 'market-not-buyable', reason: primary.error.reason });
  }

  // Attribution for the order. Not a security control, but a failure here means
  // we would build unattributed volume, so it denies rather than proceeding.
  const attribution = serializeAttribution({ app: 'blink', surface: 'blink' });
  if (!attribution.ok) {
    return fail({ kind: 'unavailable', detail: 'attribution could not be serialized' });
  }

  const cfg = { client: deps.client, wallet: account };

  // Gate 7 — quote, then build. Both are Panta calls; any transport failure is
  // mapped to a typed upstream failure, never rethrown.
  let built;
  try {
    const quote = await requestBuyQuote(cfg, {
      marketId: input.marketId,
      side: order.side,
      amountUsdc: order.amountUsdc,
      userId: attribution.value,
    });

    // The quote must be for the market and side we asked for. If it is not, we
    // are already looking at an upstream that answered a different question, so
    // there is no point building on it (Phase 3: T3).
    if (quote.marketId !== input.marketId || quote.side !== order.side) {
      return fail({
        kind: 'upstream',
        transport: null,
        detail: 'quote did not match the requested market and side',
      });
    }

    built = await buildBuyOrder(cfg, { quoteId: quote.quoteId, userId: attribution.value });
  } catch (e) {
    if (e instanceof PantaCallError) {
      return fail({ kind: 'upstream', transport: e.transport, detail: 'Panta call failed' });
    }
    // An unexpected throw is still a refusal, and its detail is never returned
    // to the caller (Phase 2: no internals in a response body).
    return fail({ kind: 'upstream', transport: null, detail: 'order build failed' });
  }

  // Gate 8 — echo cross-check (Phase 3: T3 parameter substitution). Panta's own
  // description of what it built must equal what we asked for. This is the check
  // that catches a confused or compromised upstream returning an order for a
  // different wallet, market, side or amount while still requiring only the
  // user's signature. The amount is compared in BASE UNITS: "5" and "5.00" are
  // the same money, and comparing strings would either false-alarm or, worse, be
  // "fixed" with a numeric coercion.
  const requestedUnits = usdcDecimalToBaseUnits(order.amountUsdc);
  const echoedUnits = usdcDecimalToBaseUnits(built.amountUsdc);
  if (
    built.marketId !== input.marketId ||
    built.side !== order.side ||
    built.wallet !== account ||
    echoedUnits !== requestedUnits
  ) {
    return fail({
      kind: 'upstream',
      transport: null,
      detail: 'build did not echo the requested order',
    });
  }

  // Gate 9 — assemble. This enforces the signer gate (exactly one required
  // signer, and it must be `account`), asserts every address and data blob, and
  // re-decodes the final bytes so what the wallet is asked to sign is
  // byte-for-byte what was validated (Phase 3: T2 signer substitution,
  // instruction injection, TOCTOU).
  const assembled = assembleUnsignedTransaction({
    feePayer: account,
    instructions: built.instructions,
    recentBlockhash: built.recentBlockhash,
    lastValidBlockHeight: built.lastValidBlockHeight,
  });
  if (!assembled.ok) {
    return fail({ kind: 'unbuildable', reason: assembled.error.kind });
  }

  // Gate 10 — record BEFORE returning (Phase 2). A transaction we cannot account
  // for is a transaction someone can sign without us knowing; the ledger write
  // failing is therefore a refusal, not a warning.
  try {
    await deps.recordOrder({
      orderId: built.orderId,
      quoteId: built.quoteId,
      marketId: built.marketId,
      side: built.side,
      wallet: account,
      // Panta's own echo of the amount, already cross-checked equal to the
      // requested preset in base units.
      amountUsdc: built.amountUsdc,
      expectedShares: built.expectedShares,
      feeUsdc: built.feeUsdc,
      sourceApp: 'blink',
      sourceSurface: 'blink',
      volumeClass: 'user',
      status: 'built',
      signature: null,
      createdAt: unixSeconds(deps.nowSec()),
      buildExpiresAt: built.buildExpiresAt,
    });
  } catch {
    return fail({ kind: 'unavailable', detail: 'the order could not be recorded' });
  }

  return {
    ok: true,
    transaction: assembled.value,
    message: orderMessage(fixture, order),
  };
}

/** The real collaborators. Kept here so the route stays a pure HTTP adapter. */
export function defaultBlinkOrderDeps(client: PantaClient): BlinkOrderDeps {
  return {
    client,
    // Lazy import on purpose (Phase 4b): the catalog-gated resolver sits behind
    // `next/cache` (`use cache`), and this module must stay framework-free so
    // the gate sequence is unit-testable without Next in the module graph. Only
    // the route calls this factory, so the framework module loads once, at the
    // edge, not at import time.
    loadMarket: (marketId) =>
      import('./market').then((m) => m.loadBlinkMarket(marketId)),
    recordOrder: insertPendingOrder,
    consumeLimit: consumeRateLimit,
    nowSec: () => Math.floor(Date.now() / 1000),
  };
}
