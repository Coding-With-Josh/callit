/**
 * buy/client — client-side parse / verify / assemble for the primary-buy flow.
 *
 * Owns: re-validating the JSON our own routes return, comparing Panta's echo of
 * the order against what we asked for, and compiling the order's instructions
 * into an unsigned wire transaction.
 * Must not import: React, Next, or any UI module. Pure and unit-testable.
 *
 * Phase 1 (untrusted input): a network response is not trusted just because it
 * came from our own origin. Every field is re-parsed against a strict schema
 * (unknown keys rejected) at the browser boundary, so a confused/proxied
 * response can never reach the wallet as a loosely-shaped object.
 *
 * Phase 3 (parameter substitution / wallet substitution): the server echoes the
 * quote, market, side, wallet and amount Panta actually built. verifyBuyOrder
 * compares that echo against the request in one place. A mismatch is a refusal
 * — we never assemble or sign an order that answers a different question than
 * the one the user authorised. Amounts are compared in BASE UNITS, never as
 * decimal strings, so "25" and "25.00" cannot be treated as different.
 */
import { z } from 'zod';
import {
  derivedAccountsWireSchema,
  err,
  marketIdSchema,
  ok,
  orderIdSchema,
  priceSchema,
  quoteIdSchema,
  rawInstructionSchema,
  sharesSchema,
  sideWireSchema,
  unixSecondsSchema,
  usdcDecimalSchema,
  usdcDecimalToBaseUnits,
  walletAddressSchema,
} from '@/types';
import type {
  BuiltOrder,
  BuyQuote,
  PantaTransaction,
  Result,
  Side,
  UsdcDecimal,
  WalletAddress,
} from '@/types';
import { assembleUnsignedTransaction, type AssembleError } from '@/lib/solana/assemble';

/**
 * Phase 1 (allow-list fields): the exact shape our quote route returns. `.strict`
 * (via strictObject) rejects unknown properties rather than silently carrying
 * them forward.
 */
export const buyQuoteResponseSchema = z.strictObject({
  quoteId: quoteIdSchema,
  marketId: marketIdSchema,
  side: sideWireSchema,
  shares: sharesSchema,
  avgPrice: priceSchema,
  feeUsdc: usdcDecimalSchema,
  expiresAt: unixSecondsSchema,
});

/** The strict shape of the built order our route returns. */
export const builtOrderResponseSchema = z.strictObject({
  orderId: orderIdSchema,
  quoteId: quoteIdSchema,
  marketId: marketIdSchema,
  side: sideWireSchema,
  wallet: walletAddressSchema,
  amountUsdc: usdcDecimalSchema,
  // A build with no instructions is refused here (fail closed): there would be
  // nothing to sign, and assembling an empty transaction must never be reached.
  instructions: z.array(rawInstructionSchema).min(1),
  recentBlockhash: z.string().min(1),
  lastValidBlockHeight: z.number().int().nonnegative(),
  // zod v4's z.record silently drops `__proto__`; derivedAccountsWireSchema
  // validates the raw keys first (Phase 3: prototype pollution).
  derived: derivedAccountsWireSchema,
  expectedShares: sharesSchema,
  feeUsdc: usdcDecimalSchema,
  buildExpiresAt: unixSecondsSchema,
});

/** Why a buy response could not be used. Fixed copy; never carries internals. */
export type BuyClientError =
  | { readonly kind: 'malformed-quote' }
  | { readonly kind: 'malformed-order' }
  | { readonly kind: 'order-mismatch'; readonly field: string };

/**
 * Parse an untrusted quote response. Returns a typed error rather than throwing
 * so the caller can map it to user copy without a try/catch around the render.
 */
export function parseBuyQuote(raw: unknown): Result<BuyQuote, BuyClientError> {
  const parsed = buyQuoteResponseSchema.safeParse(raw);
  if (!parsed.success) return err({ kind: 'malformed-quote' });
  return ok(parsed.data);
}

/** Parse an untrusted built-order response. */
export function parseBuiltOrder(raw: unknown): Result<BuiltOrder, BuyClientError> {
  const parsed = builtOrderResponseSchema.safeParse(raw);
  if (!parsed.success) return err({ kind: 'malformed-order' });
  return ok(parsed.data);
}

/** What the user asked to buy — the reference verifyBuyOrder checks against. */
export interface BuyOrderRequest {
  readonly marketId: BuyQuote['marketId'];
  readonly side: Side;
  readonly amountUsdc: UsdcDecimal;
  /** Session identity wallet; the only wallet that may pay for this order. */
  readonly wallet: WalletAddress;
}

function sameBaseUnits(a: UsdcDecimal, b: UsdcDecimal): boolean {
  try {
    return usdcDecimalToBaseUnits(a) === usdcDecimalToBaseUnits(b);
  } catch {
    // Either value is not a valid decimal amount — treat as a mismatch rather
    // than coercing (fail closed).
    return false;
  }
}

/**
 * Verify Panta's echo of the built order against the request and the quote.
 * Returns the order unchanged on success; a mismatch is a typed refusal.
 *
 * This is the single check that the bytes about to be signed are the bytes for
 * the order the user saw (Phase 3: parameter substitution by a confused
 * upstream, or a cross-request mix-up at the proxy).
 */
export function verifyBuyOrder(
  quote: BuyQuote,
  order: BuiltOrder,
  requested: BuyOrderRequest,
): Result<BuiltOrder, BuyClientError> {
  if (order.quoteId !== quote.quoteId) {
    return err({ kind: 'order-mismatch', field: 'quoteId' });
  }
  if (order.marketId !== requested.marketId) {
    return err({ kind: 'order-mismatch', field: 'marketId' });
  }
  if (order.side !== requested.side) {
    return err({ kind: 'order-mismatch', field: 'side' });
  }
  if (order.wallet !== requested.wallet) {
    return err({ kind: 'order-mismatch', field: 'wallet' });
  }
  if (!sameBaseUnits(order.amountUsdc, requested.amountUsdc)) {
    return err({ kind: 'order-mismatch', field: 'amountUsdc' });
  }
  return ok(order);
}

/**
 * Compile the order's Panta instructions into an unsigned wire transaction.
 *
 * All fail-closed gates — exactly one required signer, valid addresses/data,
 * and the TOCTOU re-decode — live in lib/solana/assemble; this wrapper only
 * binds the order's blockhash window and the session wallet as fee payer.
 */
export function assembleBuyOrder(
  order: BuiltOrder,
  feePayer: WalletAddress,
): Result<PantaTransaction, AssembleError> {
  return assembleUnsignedTransaction({
    feePayer,
    recentBlockhash: order.recentBlockhash,
    lastValidBlockHeight: order.lastValidBlockHeight,
    instructions: order.instructions,
  });
}

/**
 * A user-safe explanation for an assemble failure. Fixed copy: the underlying
 * `AssembleError.message` values are our own generic strings, but this keeps a
 * single place where a future message could be added without leaking upstream
 * detail into the UI (Phase 2).
 */
export function describeAssembleError(error: AssembleError): string {
  switch (error.kind) {
    case 'empty-instructions':
      return 'Panta returned no instructions to sign.';
    case 'unexpected-signers':
      return 'Refusing: this order needs more than one signer.';
    case 'signer-mismatch':
      return 'Refusing: this order is not signable by your wallet.';
    default:
      return 'The order could not be prepared for signing.';
  }
}

/** Fixed user copy for a malformed/mismatched response. */
export function describeBuyClientError(error: BuyClientError): string {
  switch (error.kind) {
    case 'malformed-quote':
    case 'malformed-order':
      return "Panta's response could not be read.";
    case 'order-mismatch':
      return 'Refusing: the order does not match what you asked for.';
  }
}

/**
 * Fixed user copy for a failed REPORT (`POST /api/panta/buy/submit`), keyed by
 * our own route's status. Never the response body.
 *
 * Report needs its own copy because the shared prepare copy is actively wrong
 * here. `describeBuyClientError`/prepare copy talks about preparing an order, and
 * a 400 is rendered elsewhere as "that order isn't valid. Check the amount and
 * try again." — but by the time this runs the wallet has ALREADY SUBMITTED the
 * transaction, so the amount was never the problem and the order may already
 * have moved money.
 *
 * The single most important property (Phase 3: false reassurance after money
 * moved): no branch may claim the order did not happen. Every message here
 * describes an order that is on-chain, and the action it gives is to check your
 * own positions — never to buy again as if nothing had occurred.
 *
 *   - a transient failure ("not recorded yet") says so, and says that reporting
 *     again re-sends the same order;
 *   - a 409 (our route maps the upstream stale-quote refusal QUOTE_EXPIRED to
 *     409, and a 409 is also how a finished session would arrive) is TERMINAL:
 *     retrying cannot change it, so it says Panta refused and sends the user to
 *     their positions.
 *
 * Retrying is safe by construction: the report is keyed by the wallet's
 * transaction signature, which is idempotent upstream, so a re-send cannot place
 * a second order.
 */
export function describeBuyReportError(status: number): string {
  // 401/403 is OUR session guard: an upstream auth failure is mapped to 502
  // before it can reach here, so this one really is about the user's session.
  if (status === 401 || status === 403) return 'Sign in to continue.';
  if (status === 429) return 'Too many requests — wait a moment and try again.';
  // The order is on-chain; Panta looks at the chain, not at this request.
  // Reporting again is safe and is the only action that can help.
  if (status === 409) {
    return 'Your order was submitted, but Panta refused to record it — the quote it was built from had expired. Check your positions before buying again.';
  }
  // Everything else (400, 404, 502, 503, 504, and any unexpected status) is an
  // UNCONFIRMED report about a submitted order. Saying "nothing happened" here
  // would be the dangerous lie: the transaction is on-chain either way.
  return "Your order was submitted, but Panta hasn't recorded it yet. Check your positions before buying again.";
}
