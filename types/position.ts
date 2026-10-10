/**
 * position — a wallet's position in a market (domain view).
 *
 * Owns: the Position domain type and the pure role derivation for a market.
 * Must not import: adapters, Panta wire, or any framework. A Position is a
 * derived relationship, never a stored user type.
 */
import type { MarketId } from './ids';
import type { Shares } from './money';
import type { MarketPhase, Side } from './market';

/** A single side-holding in a market. */
export interface Position {
  readonly marketId: MarketId;
  readonly category: string | null;
  readonly side: Side;
  readonly shares: Shares;
  readonly phase: MarketPhase;
  readonly claimable: boolean;
  readonly claimed: boolean;
  readonly outcome: Side | null;
}

/** Roles are relationships derived per market, never stored user types. */
export type MarketRole =
  | 'created-by'
  | 'holds-side'
  | 'can-claim-win'
  | 'can-claim-creator-fees';

/** Inputs to role derivation for one market. */
export interface RoleInputs {
  readonly createdByMe: boolean;
  readonly position: Position | null;
  readonly creatorFeesClaimable: boolean;
}

/** Pure: derive this wallet's roles for a market from data. */
export function deriveMarketRoles(inputs: RoleInputs): readonly MarketRole[] {
  const roles: MarketRole[] = [];
  if (inputs.createdByMe) roles.push('created-by');
  if (inputs.position !== null) roles.push('holds-side');
  if (inputs.position !== null && inputs.position.claimable) {
    roles.push('can-claim-win');
  }
  if (inputs.creatorFeesClaimable) roles.push('can-claim-creator-fees');
  return roles;
}
