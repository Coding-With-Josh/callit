/**
 * panta-wire/positions — GET /positions/ wire schema.
 *
 * Owns: the per-wallet positions response. Shares only (not USD). YES and NO
 * come back as separate rows. The indexer can lag after a purchase.
 * Must not import: domain modules. Raw shapes only.
 */
import { z } from 'zod';
import { marketPhaseWireSchema, sideWireSchema } from './common';

/** Provenance: documented. One position row. `category` and `outcome` are nullable. */
export const positionRowWireSchema = z.object({
  marketId: z.string(),
  category: z.string().nullable(),
  side: sideWireSchema,
  shares: z.string(),
  phase: marketPhaseWireSchema,
  claimable: z.boolean(),
  claimed: z.boolean(),
  outcome: z.string().nullable(),
});
export type PositionRowWire = z.infer<typeof positionRowWireSchema>;

/** Provenance: documented. GET /positions/?wallet= response. */
export const positionsResponseSchema = z.object({
  wallet: z.string(),
  positions: z.array(positionRowWireSchema),
});
export type PositionsResponse = z.infer<typeof positionsResponseSchema>;
