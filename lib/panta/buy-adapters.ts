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
  type Result,
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
import { baseUnitsToUsdcDecimal, baseUnitsFromJson, baseUnitsJsonSchema, parseVerifyAmount } from '@/types/money';
import { quoteIdSchema, orderIdSchema, txSignatureSchema, marketIdSchema, walletAddressSchema } from '@/types/ids';
import { priceSchema, sharesSchema, usdcDecimalSchema } from '@/types/money';
import type { PantaClient, PantaTransportError } from './client';
import { PantaCallError, wireBaseUnitsToUsdc, wireIsoToUnixSeconds } from './client';

export interface BuyAdaptersConfig {
  readonly client: PantaClient;
  readonly wallet: string;
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
  const r = await config.client.request({
    method: 'POST',
    path: '/primaryorderquote/',
    body,
    schema: primaryOrderQuoteResponseSchema,
  });
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
