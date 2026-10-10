/**
 * claim — win-claim and creator-fee-claim domain types.
 *
 * Owns: WinClaim and CreatorFeeClaim, the two claim-shaped actions.
 * Must not import: adapters, network, or any framework.
 *
 * Note: creator-fee claims require a graduated market and nonzero fees, and are
 * NOT reportable via POST /trades/ (it returns TX_MISMATCH).
 */
import type { MarketId } from './ids';
import type { Shares, UsdcDecimal } from './money';
import type { Side } from './market';
import type { RawInstruction } from './panta-wire/common';

/** A winning-shares claim: the transaction that redeems a winning position. */
export interface WinClaim {
  readonly marketId: MarketId;
  readonly side: Side;
  readonly winningShares: Shares;
  readonly instructions: readonly RawInstruction[];
  readonly recentBlockhash: string;
}

/** A creator-fee claim: available only on a graduated market with nonzero fees. */
export interface CreatorFeeClaim {
  readonly marketId: MarketId;
  readonly claimableFeesUsdc: UsdcDecimal;
  readonly instructions: readonly RawInstruction[];
  readonly recentBlockhash: string;
}
