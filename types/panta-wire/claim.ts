/**
 * panta-wire/claim — win-claim and creator-fee-claim wire schemas.
 *
 * Owns: the build request/response shapes for POST /claim/build/ and
 * POST /claim/creator-fees/build/.
 * Must not import: domain modules. Raw shapes only.
 *
 * Money rule: `claimableFeesUsdc` is USDC BASE UNITS as an integer string
 * ("2500000" = 2.50 USDC), converted to a decimal at the transport edge.
 * Note: creator-fee claims require a graduated market and are NOT reportable
 * via POST /trades/ (it returns TX_MISMATCH).
 */
import { z } from 'zod';
import {
  baseUnitStringWireSchema,
  derivedAccountsWireSchema,
  rawInstructionSchema,
} from './common';

/** Provenance: documented. POST /claim/build/ request body. */
export const claimBuildRequestSchema = z.object({
  wallet: z.string(),
  marketId: z.string(),
});
export type ClaimBuildRequest = z.infer<typeof claimBuildRequestSchema>;

/** Provenance: documented. POST /claim/build/ response. `outcome` is a label (e.g. "YES"). */
export const claimBuildResponseSchema = z.object({
  wallet: z.string(),
  marketId: z.string(),
  outcome: z.string(),
  winningShares: z.string(),
  instructions: z.array(rawInstructionSchema),
  derived: derivedAccountsWireSchema.optional(),
  recentBlockhash: z.string(),
  lastValidBlockHeight: z.number().int(),
});
export type ClaimBuildResponse = z.infer<typeof claimBuildResponseSchema>;

/** Provenance: documented. POST /claim/creator-fees/build/ request body. */
export const creatorFeesBuildRequestSchema = z.object({
  wallet: z.string(),
  marketId: z.string(),
});
export type CreatorFeesBuildRequest = z.infer<
  typeof creatorFeesBuildRequestSchema
>;

/** Provenance: documented. POST /claim/creator-fees/build/ response. */
export const creatorFeesBuildResponseSchema = z.object({
  wallet: z.string(),
  marketId: z.string(),
  claimableFeesUsdc: baseUnitStringWireSchema,
  instructions: z.array(rawInstructionSchema),
  derived: derivedAccountsWireSchema.optional(),
  recentBlockhash: z.string(),
  lastValidBlockHeight: z.number().int(),
});
export type CreatorFeesBuildResponse = z.infer<
  typeof creatorFeesBuildResponseSchema
>;
