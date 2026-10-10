/**
 * panta-wire/metrics — GET /account/metrics/ wire schema.
 *
 * Owns: the documented account-metrics response: a summary plus recent create
 * and attributed-trade rows. This is an ACCOUNT/ops surface (not a per-user
 * flow); it is modelled for completeness and is not consumed by the app yet.
 * Must not import: domain modules. Raw shapes only.
 *
 * Unit note: `summary.trades.volumeUsdcBase` is a NUMBER in base units; each
 * trade row carries BOTH `amountUsdc` (human decimal) and `amountUsdcBase`
 * (string). Timestamps are ISO-8601.
 */
import { z } from 'zod';
import { isoTimestampWireSchema, sideWireSchema } from './common';

/** A status -> count map (create statuses: `pending` | `built` | `registered` | …). */
export const statusCountsWireSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);
export type StatusCounts = z.infer<typeof statusCountsWireSchema>;

/** Provenance: documented. One recent create-session row. */
export const metricCreateRowSchema = z.object({
  createId: z.string(),
  wallet: z.string(),
  eventPda: z.string(),
  signature: z.string().nullable().optional(),
  status: z.string(),
  paymentUsdc: z.string(),
  paymentUsdcBase: z.string(),
  userId: z.string().optional(),
  apiKeyId: z.string().optional(),
  createdAt: isoTimestampWireSchema,
  updatedAt: isoTimestampWireSchema.optional(),
});
export type MetricCreateRow = z.infer<typeof metricCreateRowSchema>;

/** Provenance: documented. One recent attributed trade row. */
export const metricTradeRowSchema = z.object({
  signature: z.string(),
  wallet: z.string(),
  marketId: z.string(),
  side: sideWireSchema,
  kind: z.enum(['buy', 'claim']),
  amountUsdc: z.string(),
  amountUsdcBase: z.string(),
  status: z.string(),
  createdAt: isoTimestampWireSchema,
});
export type MetricTradeRow = z.infer<typeof metricTradeRowSchema>;

/** Provenance: documented. GET /account/metrics/?limit= response. */
export const accountMetricsResponseSchema = z.object({
  summary: z.object({
    creates: z.object({
      total: z.number().int().nonnegative(),
      byStatus: statusCountsWireSchema,
    }),
    trades: z.object({
      total: z.number().int().nonnegative(),
      volumeUsdcBase: z.number().int().nonnegative(),
      byKind: statusCountsWireSchema,
    }),
    keys: z.object({
      active: z.number().int().nonnegative(),
      revoked: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
  }),
  creates: z.array(metricCreateRowSchema),
  trades: z.array(metricTradeRowSchema),
});
export type AccountMetricsResponse = z.infer<
  typeof accountMetricsResponseSchema
>;
