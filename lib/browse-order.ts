/**
 * browse-order — the visibility and ordering rules for the landing Browse.
 *
 * Owns: which loaded markets may render as a row at all, what a market with no
 * upstream title is called, and the order the rows appear in. Extracted from the
 * client island so the two rules that were wrong — settled markets outranking
 * live ones, and the only buyable market being hidden for a missing title — are
 * pure, unit-tested functions instead of details of JSX.
 * Must not import: React or Next.
 *
 * Presentation only. Nothing here grants or denies buy access; the buy gate is
 * `types/market::requirePrimaryMarket`, re-checked inside TradeDeck and again
 * inside BuySlip (Phase 1: complete mediation).
 */
import type { MarketFixture } from '@/lib/market-fixtures';
import type { Market, MarketPhase } from '@/types';

/** How the filtered list is ordered. Volume is the default (BigInt, no floats). */
export type SortKey = 'volume' | 'closing' | 'newest';

export const SORT_KEYS: readonly SortKey[] = ['volume', 'closing', 'newest'];

/** Rows revealed on first paint and on each "Load more" press. */
export const PAGE_SIZE = 12;

/**
 * A settled market can no longer be traded: it resolved, or it was cancelled.
 *
 * Keyed on the `resolved` flag, NOT the wire's `phase` string. `phase` has been
 * observed alternating between "resolved" and "secondary" for the SAME settled
 * market between requests, while `resolved` stayed true — so any sort, filter or
 * label built on `phase` reshuffles the list and mislabels rows between loads.
 * `phase === 'cancelled'` is included because the flag does not cover it.
 * Fail-closed direction: an unknown/absent phase is treated as unsettled unless
 * the flag says otherwise, so a live market is never silently hidden.
 */
export const isSettled = (market: Market): boolean =>
  market.resolved || market.phase === 'cancelled';

/**
 * Whether a loaded market may be shown as a row at all.
 *
 * Panta returns `title: ""` for most auto-generated markets, and a blank
 * heading reads as a broken row — so a settled market with no title is dropped.
 * A market that is still live is NEVER dropped for a missing title: in the live
 * catalog the single buyable market is untitled, so that rule hid the only row a
 * visitor could act on. It renders with the same fallback the detail page uses.
 */
export const isPresentable = (fixture: MarketFixture): boolean =>
  fixture.market.title.trim() !== '' || !isSettled(fixture.market);

/** The row/detail heading for a market: upstream title, or an explicit fallback. */
export const displayTitle = (market: Market): string =>
  market.title.trim() || 'Untitled market';

/**
 * The market's phase with the unstable wire value normalised away.
 *
 * `phase` flips between "resolved" and "secondary" for the same settled market
 * between requests, which made a row's own label (and any chip filtering on it)
 * change between loads. The `resolved` flag is stable, so it wins; `cancelled`
 * is preserved because no flag distinguishes it. Chips, chip filtering and row
 * labels all read this instead of the raw `phase`, so what a chip selects and
 * what a row says can never disagree.
 */
export const effectivePhase = (market: Market): MarketPhase =>
  market.phase === 'cancelled'
    ? 'cancelled'
    : market.resolved
      ? 'resolved'
      : market.phase;

/**
 * Compare two USDC decimal strings DESCENDING without float conversion: whole
 * units as BigInt, then the zero-padded 6-decimal fractions as strings. Ordering
 * only — never used to compute a displayed number.
 */
const compareUsdcDesc = (a: string, b: string): number => {
  const [aw = '0', af = ''] = a.split('.');
  const [bw = '0', bf = ''] = b.split('.');
  const wa = BigInt(aw);
  const wb = BigInt(bw);
  if (wa !== wb) return wa > wb ? -1 : 1;
  const fa = `${af}000000`.slice(0, 6);
  const fb = `${bf}000000`.slice(0, 6);
  if (fa === fb) return 0;
  return fa > fb ? -1 : 1;
};

/**
 * Deterministic ordering, with live markets always ahead of settled ones.
 *
 * Settled markets have accumulated the most volume, so a plain volume sort put a
 * wall of resolved markets at the top of a share-first list, and every row a
 * visitor tapped was a dead end. The rank is therefore applied BEFORE the chosen
 * sort. Within a rank the order is fully deterministic (a display-title
 * tiebreak), so the list never reshuffles on an unrelated state change.
 */
export const compareMarkets = (
  a: MarketFixture,
  b: MarketFixture,
  sort: SortKey,
): number => {
  const A = a.market;
  const B = b.market;

  const rank = Number(isSettled(A)) - Number(isSettled(B));
  if (rank !== 0) return rank;

  const primary =
    sort === 'volume'
      ? compareUsdcDesc(A.volumeUsdc, B.volumeUsdc)
      : sort === 'closing'
        ? A.endTime - B.endTime
        : B.startTime - A.startTime;
  return primary !== 0 ? primary : displayTitle(A).localeCompare(displayTitle(B));
};
