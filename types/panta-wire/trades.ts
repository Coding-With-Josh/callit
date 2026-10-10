/**
 * panta-wire/trades — the trade-report and trade-status wire schemas.
 *
 * Owns: the request/response shapes for POST /trades/ (report a buy or win
 * claim signature for attribution) and GET /trades/{signature}/ (status).
 * Must not import: domain modules. Raw shapes only.
 *
 * Documented behaviour: reporting is idempotent per signature; `kind` is
 * INFERRED by Panta (buy vs win claim) and is not a request field. It returns
 * TX_NOT_FOUND until the tx is observed and TX_MISMATCH for creator-fee claims.
 */
import { z } from 'zod';
import { sideWireSchema } from './common';

/** Provenance: documented. POST /trades/ request body. */
export const tradeReportRequestSchema = z.object({
  signature: z.string(),
  wallet: z.string().optional(),
  marketId: z.string().optional(),
  quoteId: z.string().optional(),
  clientOrderId: z.string().optional(),
  /** Attribution id; defaults from the API-key account or X-User-Id. */
  userId: z.string().optional(),
});
export type TradeReportRequest = z.infer<typeof tradeReportRequestSchema>;

/** Provenance: documented. POST /trades/ response. */
export const tradeReportResponseSchema = z.object({
  signature: z.string(),
  status: z.string(),
  marketId: z.string().optional(),
  wallet: z.string().optional(),
  side: sideWireSchema.optional(),
  kind: z.enum(['buy', 'claim']).optional(),
});
export type TradeReportResponse = z.infer<typeof tradeReportResponseSchema>;

/** Provenance: documented. GET /trades/{signature}/ response. */
export const tradeStatusResponseSchema = z.object({
  signature: z.string(),
  status: z.enum([
    'processed',
    'pending_attribution',
    'unknown',
    'failed',
  ]),
  marketId: z.string().optional(),
  wallet: z.string().optional(),
});
export type TradeStatusResponse = z.infer<typeof tradeStatusResponseSchema>;
