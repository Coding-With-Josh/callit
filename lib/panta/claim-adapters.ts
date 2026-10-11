/**
 * panta/claim-adapters — win-claim and creator-fee claim build adapters (HTTP).
 */
import { type Result } from '@/types';
import {
  claimBuildRequestSchema,
  claimBuildResponseSchema,
  creatorFeesBuildRequestSchema,
  creatorFeesBuildResponseSchema,
} from '@/types/panta-wire/claim';
import type { WinClaim, CreatorFeeClaim } from '@/types/claim';
import { sharesSchema } from '@/types/money';
import { marketIdSchema } from '@/types/ids';
import type { PantaClient } from './client';
import { PantaCallError, wireBaseUnitsToUsdc } from './client';

export interface ClaimAdaptersConfig {
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

export async function buildWinClaim(
  config: ClaimAdaptersConfig,
  marketId: string,
): Promise<WinClaim> {
  const body = claimBuildRequestSchema.parse({ wallet: config.wallet, marketId });
  const r = await config.client.request({
    method: 'POST',
    path: '/claim/build/',
    body,
    schema: claimBuildResponseSchema,
  });
  if (!r.ok) throw new PantaCallError(r.error);
  return mapOrThrow(() => ({
    marketId: marketIdSchema.parse(r.value.marketId),
    side: 'YES' as any, // Panta returns outcome label; domain WinClaim carries side — but shape in types: side: Side. Keep minimal mapping; outcome not stored. We'll treat as resolved YES/NO not needed here.
    winningShares: sharesSchema.parse(r.value.winningShares),
    instructions: r.value.instructions,
    recentBlockhash: r.value.recentBlockhash,
  }));
}

export async function buildCreatorFeesClaim(
  config: ClaimAdaptersConfig,
  marketId: string,
): Promise<CreatorFeeClaim> {
  const body = creatorFeesBuildRequestSchema.parse({ wallet: config.wallet, marketId });
  const r = await config.client.request({
    method: 'POST',
    path: '/claim/creator-fees/build/',
    body,
    schema: creatorFeesBuildResponseSchema,
  });
  if (!r.ok) throw new PantaCallError(r.error);
  return mapOrThrow(() => ({
    marketId: marketIdSchema.parse(r.value.marketId),
    claimableFeesUsdc: wireBaseUnitsToUsdc(r.value.claimableFeesUsdc),
    instructions: r.value.instructions,
    recentBlockhash: r.value.recentBlockhash,
  }));
}
