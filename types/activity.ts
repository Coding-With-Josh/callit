/**
 * activity — the derived "My activity" view.
 *
 * Owns: the single derived view a wallet sees (markets it created, positions it
 * holds, claims available), plus the claim-availability type.
 * Must not import: adapters, network, storage, or any framework. Pure types.
 */
import type { MarketId, WalletAddress } from './ids';
import type { Shares, UsdcDecimal } from './money';
import type { Market } from './market';
import type { Position } from './position';

/** A claim this wallet can make, with only the fields relevant to its kind. */
export interface ClaimAvailability {
  readonly marketId: MarketId;
  readonly kind: 'win' | 'creator-fees';
  readonly shares?: Shares;
  readonly feesUsdc?: UsdcDecimal;
}

/** One derived view over a wallet's markets, positions and claims. */
export interface MyActivity {
  readonly wallet: WalletAddress;
  readonly created: readonly Market[];
  readonly positions: readonly Position[];
  readonly claimsAvailable: readonly ClaimAvailability[];
}
