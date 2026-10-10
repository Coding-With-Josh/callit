/**
 * market — the market model and the phase guard.
 *
 * Owns: Side, MarketPhase, the Market domain type, phase-narrowed subtypes
 * (PrimaryMarket and friends), and the "buying is only valid in primary" guard
 * with an explicit link-out result for secondary/resolved/cancelled.
 * Must not import: buy/create/draft lifecycles, adapters, or any framework.
 */
import { err, ok, type Result } from './result';
import type { MarketId } from './ids';
import type { UnixSeconds } from './time';
import type { Price, UsdcDecimal } from './money';

/** Which side of a binary market: yes or no. */
export const SIDES = ['yes', 'no'] as const;
export type Side = (typeof SIDES)[number];

/** Legal market phases: primary -> secondary (graduated) -> resolved, or cancelled. */
export const MARKET_PHASES = [
  'primary',
  'secondary',
  'resolved',
  'cancelled',
] as const;
export type MarketPhase = (typeof MARKET_PHASES)[number];

/** A market as the domain sees it. Prices are nullable until filled. */
export interface Market {
  readonly marketId: MarketId;
  readonly category: string;
  readonly title: string;
  readonly description: string;
  readonly phase: MarketPhase;
  readonly volumeUsdc: UsdcDecimal;
  readonly startTime: UnixSeconds;
  readonly endTime: UnixSeconds;
  readonly resolutionTime: UnixSeconds;
  readonly resolved: boolean;
  readonly yesPrice: Price | null;
  readonly noPrice: Price | null;
}

/** A market in the primary phase — the only phase where buying is valid. */
export interface PrimaryMarket extends Market {
  readonly phase: 'primary';
}

/** A graduated market; read-only through this API (link out to Panta). */
export interface SecondaryMarket extends Market {
  readonly phase: 'secondary';
}

/** A resolved market. */
export interface ResolvedMarket extends Market {
  readonly phase: 'resolved';
}

/** A cancelled market. */
export interface CancelledMarket extends Market {
  readonly phase: 'cancelled';
}

/** Why a non-primary market cannot be bought into, and what to show instead. */
export interface MarketLinkOut {
  readonly kind: 'link-out';
  readonly phase: 'secondary' | 'resolved' | 'cancelled';
  readonly reason: string;
}

/** Type guard: is this market in the primary (buyable) phase? */
export function isPrimaryMarket(market: Market): market is PrimaryMarket {
  return market.phase === 'primary';
}

/**
 * Require a market to be primary, or return a link-out. This is the single
 * gate that makes "buying only in primary" explicit and testable.
 */
export function requirePrimaryMarket(
  market: Market,
): Result<PrimaryMarket, MarketLinkOut> {
  if (market.phase === 'primary') {
    // `market.phase === 'primary'` proves the subtype; the cast records that.
    return ok(market as PrimaryMarket);
  }
  return err({
    kind: 'link-out',
    phase: market.phase,
    reason: `market is in phase "${market.phase}"; primary buys are only valid in "primary"`,
  });
}
