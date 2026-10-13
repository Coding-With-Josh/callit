/**
 * market — the market model and the phase guard.
 *
 * Owns: Side, MarketPhase, the Market domain type, phase-narrowed subtypes
 * (PrimaryMarket and friends), the settled signal (`isSettled`/`effectivePhase`)
 * and the "buying is only valid in a live primary market" guard with an explicit
 * link-out result for secondary/resolved/cancelled.
 *
 * Why the settled signal lives here: the wire's `phase` is observed to flap
 * between "resolved" and "secondary" for the same settled market between reads,
 * while the `resolved` flag stays true. Every gate, label and sort in the app is
 * therefore keyed on the stable flag, and this module is the one place that
 * decides what "settled" and "the phase to display" mean.
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

/** A LIVE market in the primary phase — the only state where buying is valid. */
export interface PrimaryMarket extends Market {
  readonly phase: 'primary';
  /**
   * A settled market can never be bought, whatever the wire's `phase` says (see
   * `isSettled`), so the buyable subtype pins the flag instead of leaving it
   * `boolean`. `startBuyQuote` therefore cannot be handed a settled market even
   * by a caller that skipped the guard.
   */
  readonly resolved: false;
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

/**
 * A settled market can no longer be traded: it resolved, or it was cancelled.
 *
 * Keyed on the `resolved` flag, NOT the wire's `phase` string. Panta's `phase`
 * has been observed alternating between "resolved" and "secondary" for the SAME
 * settled market between requests, while `resolved` stayed true — so anything
 * built on `phase` alone (a sort, a filter, a row label, a buy gate) can
 * misclassify one read as another. `phase === 'cancelled'` is included because no
 * flag distinguishes that case.
 */
export const isSettled = (market: Market): boolean =>
  market.resolved || market.phase === 'cancelled';

/**
 * The market's phase with the unstable wire value normalised away.
 *
 * `phase` flips between "resolved" and "secondary" for the same settled market
 * between reads, which made a row's own label, the browse's phase chips, and the
 * detail page's "resolved"/"graduated" headline change under the user. The stable
 * `resolved` flag wins; `cancelled` is preserved because no flag marks it. Every
 * surface that NAMES a phase reads this instead of the raw value, so two reads of
 * one market cannot disagree.
 */
export const effectivePhase = (market: Market): MarketPhase =>
  market.phase === 'cancelled'
    ? 'cancelled'
    : market.resolved
      ? 'resolved'
      : market.phase;

/**
 * The two fields that carry "Panta served a PRICED read for this market".
 *
 * `read-adapters` maps an absent/unparseable wire price to `null` (never to 0),
 * so a null price is Panta telling us it could not read the market's on-chain
 * price on that request — not a price of zero.
 */
export type PricedFields = Pick<Market, 'yesPrice' | 'noPrice'>;

/**
 * True when BOTH sides carry a price, i.e. Panta served the priced variant of
 * this market rather than the lean one.
 *
 * Why this is a gate and not a display detail (measured live 2026-10-13):
 * Panta serves the market read in two variants per request, and while a market
 * is in the lean one `/primaryorderquote/` answers a bare
 * `{"code":"INVALID_MARKET_PARAMS"}` — so a buy slip that invites an amount
 * during an unpriced window collects an order that cannot be quoted at all. The
 * window is per-market and lasts seconds to tens of seconds (one market's
 * `/prices/` path read 200, 200, 404, 404, 200 inside twelve seconds), so the
 * answer is to fail closed at the control and offer a re-check, never to promise
 * the order will go through.
 *
 * BOTH sides are required, which fails closed: a binary market has a price on
 * each side on-chain, so a half-priced read is not trustworthy enough to quote
 * from.
 */
export const isPriced = (market: PricedFields): boolean =>
  market.yesPrice !== null && market.noPrice !== null;

/** Type guard: is this market a LIVE primary market (the only buyable state)? */
export function isPrimaryMarket(market: Market): market is PrimaryMarket {
  // Both conditions. `phase` alone is an upstream string that flaps; the stable
  // `resolved` flag is what makes "primary" mean "still buyable".
  return market.phase === 'primary' && !market.resolved;
}

/**
 * The phase word a link-out report shows.
 *
 * Never "primary": a link-out is only built for a market that is NOT buyable, so
 * reporting "primary" would describe a live market as un-buyable. The stable
 * `resolved` flag outranks the flapping wire string, so a settled market always
 * reads as resolved rather than sometimes as "graduated".
 */
function linkOutPhase(market: Market): MarketLinkOut['phase'] {
  if (market.phase === 'cancelled') return 'cancelled';
  if (market.resolved) return 'resolved';
  return market.phase === 'resolved' ? 'resolved' : 'secondary';
}

/**
 * Require a market to be a LIVE primary market, or return a link-out. This is the
 * single gate that makes "buying only in primary" explicit and testable.
 *
 * BOTH conditions are required (Phase 3: buy-control bypass). A phase-only gate
 * would render buy controls for a settled market whose `phase` had flapped to
 * "primary", offering an action the POST path refuses. Fail-closed: absent proof
 * that the market is live, the answer is no.
 */
export function requirePrimaryMarket(
  market: Market,
): Result<PrimaryMarket, MarketLinkOut> {
  if (isPrimaryMarket(market)) {
    // The guard proves phase and `resolved: false`; narrowing records that.
    return ok(market);
  }
  return err({
    kind: 'link-out',
    phase: linkOutPhase(market),
    reason: `market is not a live primary market (phase "${market.phase}", resolved ${market.resolved}); primary buys are only valid in "primary"`,
  });
}
