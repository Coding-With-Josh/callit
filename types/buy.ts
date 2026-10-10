/**
 * buy — the primary-buy lifecycle state machine.
 *
 * Owns: BuyQuote, BuiltOrder, the BuyLifecycle discriminated union, its legal
 * transitions, and the guarded entry point.
 * Must not import: adapters, network, or any framework.
 *
 * Illegal states are unrepresentable: a quote state carries an `expiresAt` and
 * no signature; only later states carry a signature. The entry point accepts
 * only a PrimaryMarket, so a secondary/resolved market cannot start a buy.
 */
import { err, ok, type Result } from './result';
import type { QuoteId, OrderId, TxSignature, MarketId } from './ids';
import type { Price, Shares, UsdcDecimal } from './money';
import type { UnixSeconds } from './time';
import type { PrimaryMarket, Side } from './market';
import type { RawInstruction } from './panta-wire/common';
import type { PantaError } from './errors';

/** A primary-order quote: valid until `expiresAt`, with no signature yet. */
export interface BuyQuote {
  readonly quoteId: QuoteId;
  readonly marketId: MarketId;
  readonly side: Side;
  readonly shares: Shares;
  readonly avgPrice: Price;
  readonly feeUsdc: UsdcDecimal;
  readonly expiresAt: UnixSeconds;
}

/** A built order: Panta's instructions plus the blockhash window. */
export interface BuiltOrder {
  readonly orderId: OrderId;
  readonly instructions: readonly RawInstruction[];
  readonly recentBlockhash: string;
  readonly lastValidBlockHeight: number;
  readonly derived: Readonly<Record<string, string>>;
  readonly expectedShares: Shares;
  readonly feeUsdc: UsdcDecimal;
  readonly buildExpiresAt: UnixSeconds;
}

/** Every stage a buy can be in. */
export type BuyStage =
  | 'quoted'
  | 'built'
  | 'signed'
  | 'broadcast'
  | 'submitted'
  | 'reported'
  | 'expired'
  | 'stale'
  | 'failed';

/** The buy lifecycle union. Each state carries only the data valid at that point. */
export type BuyLifecycle =
  | { readonly status: 'quoted'; readonly market: PrimaryMarket; readonly quote: BuyQuote }
  | { readonly status: 'built'; readonly market: PrimaryMarket; readonly quote: BuyQuote; readonly order: BuiltOrder }
  | { readonly status: 'signed'; readonly market: PrimaryMarket; readonly quote: BuyQuote; readonly order: BuiltOrder; readonly signature: TxSignature; readonly signedAt: UnixSeconds }
  | { readonly status: 'broadcast'; readonly market: PrimaryMarket; readonly quote: BuyQuote; readonly order: BuiltOrder; readonly signature: TxSignature; readonly signedAt: UnixSeconds; readonly broadcastAt: UnixSeconds }
  | { readonly status: 'submitted'; readonly market: PrimaryMarket; readonly quote: BuyQuote; readonly order: BuiltOrder; readonly signature: TxSignature; readonly signedAt: UnixSeconds; readonly broadcastAt: UnixSeconds; readonly submittedAt: UnixSeconds }
  | { readonly status: 'reported'; readonly market: PrimaryMarket; readonly quote: BuyQuote; readonly order: BuiltOrder; readonly signature: TxSignature; readonly signedAt: UnixSeconds; readonly broadcastAt: UnixSeconds; readonly submittedAt: UnixSeconds; readonly reportedAt: UnixSeconds }
  | { readonly status: 'expired'; readonly reason: 'quote_expired' | 'build_expired'; readonly at: UnixSeconds }
  | { readonly status: 'stale'; readonly reason: 'quote_stale' | 'price_moved'; readonly at: UnixSeconds }
  | { readonly status: 'failed'; readonly error: PantaError; readonly at: UnixSeconds };

/** Why a buy could not start. */
export interface BuyMarketMismatch {
  readonly kind: 'market-mismatch';
  readonly expected: MarketId;
  readonly actual: MarketId;
}

/** Legal transitions for a buy. */
export const BUY_TRANSITIONS: Readonly<Record<BuyStage, readonly BuyStage[]>> = {
  quoted: ['built', 'expired', 'stale', 'failed'],
  built: ['signed', 'expired', 'failed'],
  signed: ['broadcast', 'failed'],
  broadcast: ['submitted', 'failed'],
  submitted: ['reported', 'failed'],
  reported: [],
  expired: ['quoted'],
  stale: ['quoted'],
  failed: ['quoted'],
};

/** True when `to` is a legal next stage from `from`. */
export function canBuyTransition(from: BuyStage, to: BuyStage): boolean {
  return BUY_TRANSITIONS[from].includes(to);
}

/**
 * Start a buy quote. Only a PrimaryMarket is accepted (type-level phase guard),
 * and the quote's marketId must match the market (guards identifier substitution).
 */
export function startBuyQuote(
  market: PrimaryMarket,
  quote: BuyQuote,
): Result<BuyLifecycle, BuyMarketMismatch> {
  if (quote.marketId !== market.marketId) {
    return err({
      kind: 'market-mismatch',
      expected: market.marketId,
      actual: quote.marketId,
    });
  }
  return ok({ status: 'quoted', market, quote });
}
