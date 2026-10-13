/**
 * panta/buy-adapters — primary buy lifecycle adapters (HTTP).
 *
 * Owns: quote, build, submit, verify against Panta endpoints; maps wire to
 * domain types (BuyQuote, BuiltOrder) and back. Follows the same fail-closed
 * pattern as create-adapters (mapOrThrow + PantaCallError).
 */
import {
  type BuyQuote,
  type BuiltOrder,
  type Side,
  type UsdcDecimal,
} from '@/types';
import {
  primaryOrderBuildRequestSchema,
  primaryOrderBuildResponseSchema,
  primaryOrderQuoteRequestSchema,
  primaryOrderQuoteResponseSchema,
  primaryOrderSubmitRequestSchema,
  primaryOrderSubmitResponseSchema,
  primaryOrderVerifyRequestSchema,
  primaryOrderVerifyResponseSchema,
} from '@/types/panta-wire/buy';
import { parseVerifyAmount } from '@/types/money';
import { quoteIdSchema, orderIdSchema, marketIdSchema, walletAddressSchema } from '@/types/ids';
import { priceSchema, sharesSchema, usdcDecimalSchema } from '@/types/money';
import type { PantaClient } from './client';
import { PantaCallError, wireBaseUnitsToUsdc, wireIsoToUnixSeconds } from './client';
import { isUnpriceableQuoteError } from './transport-status';

export interface BuyAdaptersConfig {
  readonly client: PantaClient;
  readonly wallet: string;
}

/**
 * Attempts for the QUOTE call, and the flat delay between them.
 *
 * Phase 3 (unpriceable market): the quote is the one buy step where re-rolling
 * is free. Measured live (2026-10-13) against `/primaryorderquote/`: the SAME
 * market, side and amount answered 200 nine times in ten and a bare
 * `{"code":"INVALID_MARKET_PARAMS"}` (no message, no `fields`) once, while a
 * market with no price data at all answers that bare code every time. So the
 * code means "Panta could not read this market's on-chain price for THIS
 * request" — a per-request lottery, not a statement about the order. Retrying
 * it is what resolves it (the user otherwise gets an error about operands that
 * are fine).
 *
 * This is deliberately bounded and deliberately NOT applied to build or submit.
 * A quote creates no order and moves no money — it persists a throwaway
 * `quoteId` with a ~90s expiry — whereas build/submit are the steps a retry
 * could genuinely duplicate (Phase 3: retry as a duplication primitive). Only
 * `isUnpriceableQuoteError` is retried, so a graduated market, an amount error,
 * a bad id or an auth rejection still fail on the first answer, unchanged.
 */
export const QUOTE_ATTEMPTS = 4;
const QUOTE_RETRY_BASE_DELAY_MS = 140;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapOrThrow<T>(map: () => T): T {
  try {
    return map();
  } catch {
    throw new PantaCallError({
      kind: 'malformed',
      message: 'Panta response could not be mapped to the domain',
    });
  }
}

/**
 * POST /primaryorderquote/. `side` is the DOMAIN side (`'yes' | 'no'`) — the
 * wire schema is lowercase too, so it is passed through unchanged. This argument
 * was previously typed `'YES' | 'NO'`, which made `primaryOrderQuoteRequestSchema
 * .parse` throw a raw `ZodError` on every call (a 502 with a validation message,
 * outside the adapters' `mapOrThrow`). Phase 3 (unit/casing confusion at the
 * transport edge): the domain side is the only accepted form, and the regression
 * test asserts the body actually sent.
 */
export async function requestBuyQuote(
  config: BuyAdaptersConfig,
  args: { marketId: string; side: Side; amountUsdc: UsdcDecimal; userId?: string },
): Promise<BuyQuote> {
  const body = primaryOrderQuoteRequestSchema.parse({
    wallet: config.wallet,
    marketId: args.marketId,
    side: args.side,
    amountUsdc: args.amountUsdc,
    userId: args.userId,
  });
  // The SAME frozen body is sent on every attempt: no operand is re-derived from
  // anything a caller supplied between attempts (Phase 3: parameter substitution
  // via a retry), and `wallet` stays the session/report wallet from `config`.
  const requestOnce = () =>
    config.client.request({
      method: 'POST',
      path: '/primaryorderquote/',
      body,
      schema: primaryOrderQuoteResponseSchema,
    });

  let r = await requestOnce();
  for (
    let attempt = 1;
    attempt < QUOTE_ATTEMPTS && !r.ok && isUnpriceableQuoteError(r.error);
    attempt++
  ) {
    // Flat delay with jitter: these failures are independent per request, so
    // there is nothing to back off from — the wait only avoids making a tight
    // loop against an upstream account we share a 120 req/min budget with.
    await sleep(QUOTE_RETRY_BASE_DELAY_MS + Math.floor(Math.random() * 110));
    r = await requestOnce();
  }
  if (!r.ok) throw new PantaCallError(r.error);
  return mapOrThrow(() => ({
    quoteId: quoteIdSchema.parse(r.value.quoteId),
    marketId: marketIdSchema.parse(r.value.marketId),
    side: r.value.side,
    shares: sharesSchema.parse(r.value.shares),
    avgPrice: priceSchema.parse(r.value.avgPrice),
    feeUsdc: wireBaseUnitsToUsdc(r.value.feeUsdc),
    expiresAt: wireIsoToUnixSeconds(r.value.expiresAt),
  }));
}

export async function buildBuyOrder(
  config: BuyAdaptersConfig,
  args: { quoteId: string; userId?: string; maxSlippageBps?: number },
): Promise<BuiltOrder> {
  const body = primaryOrderBuildRequestSchema.parse({
    quoteId: args.quoteId,
    wallet: config.wallet,
    userId: args.userId,
    maxSlippageBps: args.maxSlippageBps,
  });
  const r = await config.client.request({
    method: 'POST',
    path: '/primaryorderbuild/',
    body,
    schema: primaryOrderBuildResponseSchema,
  });
  if (!r.ok) throw new PantaCallError(r.error);
  return mapOrThrow(() => ({
    orderId: orderIdSchema.parse(r.value.orderId),
    // Panta's echo of the order, carried into the domain so the caller can
    // compare it against what it asked for (Phase 3: parameter substitution).
    // Every field is re-validated here, so a nonsense echo fails at the
    // transport boundary rather than reaching a comparison that might coerce.
    quoteId: quoteIdSchema.parse(r.value.quoteId),
    marketId: marketIdSchema.parse(r.value.marketId),
    side: r.value.side,
    wallet: walletAddressSchema.parse(r.value.wallet),
    amountUsdc: usdcDecimalSchema.parse(r.value.amountUsdc),
    instructions: r.value.instructions,
    recentBlockhash: r.value.recentBlockhash,
    lastValidBlockHeight: r.value.lastValidBlockHeight,
    derived: r.value.derived ?? {},
    expectedShares: sharesSchema.parse(r.value.expectedShares),
    feeUsdc: wireBaseUnitsToUsdc(r.value.feeUsdc),
    buildExpiresAt: wireIsoToUnixSeconds(r.value.expiresAt),
  }));
}

export async function submitBuyOrder(
  config: BuyAdaptersConfig,
  args: { orderId: string; signature: string },
): Promise<{ orderId: string; signature: string }> {
  const body = primaryOrderSubmitRequestSchema.parse({
    orderId: args.orderId,
    signature: args.signature,
    wallet: config.wallet,
  });
  const r = await config.client.request({
    method: 'POST',
    path: '/primaryordersubmit/',
    body,
    schema: primaryOrderSubmitResponseSchema,
  });
  if (!r.ok) throw new PantaCallError(r.error);
  return { orderId: r.value.orderId, signature: r.value.signature };
}

export async function verifyBuyOrder(
  config: BuyAdaptersConfig,
  args: { orderId: string; signature?: string },
): Promise<{
  status: 'built' | 'submitted' | 'confirmed' | 'failed' | 'expired';
  marketId?: string;
  side?: Side;
  amountUsdcBase?: bigint;
}> {
  const body = primaryOrderVerifyRequestSchema.parse({
    orderId: args.orderId,
    signature: args.signature,
    wallet: config.wallet,
  });
  const r = await config.client.request({
    method: 'POST',
    path: '/primaryorderverify/',
    body,
    schema: primaryOrderVerifyResponseSchema,
  });
  if (!r.ok) throw new PantaCallError(r.error);
  let amountUsdcBase: bigint | undefined;
  if (r.value.amountUsdc !== undefined) {
    amountUsdcBase = BigInt(parseVerifyAmount(r.value.amountUsdc));
  }
  return {
    status: r.value.status,
    marketId: r.value.marketId,
    // The wire side is already the domain side (`'yes' | 'no'`). This previously
    // upper-cased it into `'YES' | 'NO'`, reintroducing at the exit the same
    // unit/casing confusion the input side had at the entrance (Phase 3).
    side: r.value.side,
    amountUsdcBase,
  };
}
