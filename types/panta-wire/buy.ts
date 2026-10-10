/**
 * panta-wire/buy — the primary-buy lifecycle wire schemas.
 *
 * Owns: quote, build, submit and verify request/response shapes for a primary
 * YES/NO buy.
 * Must not import: domain modules. Raw shapes only.
 *
 * Documented unit quirks: quote/build return human DECIMAL strings; verify
 * returns `amountUsdc` as a NUMBER in BASE UNITS. Quote/build `expiresAt` is
 * ISO-8601. Build returns an instruction list (not a fully assembled tx).
 */
import { z } from 'zod';
import {
  baseUnitNumberWireSchema,
  derivedAccountsWireSchema,
  isoTimestampWireSchema,
  rawInstructionSchema,
  sideWireSchema,
} from './common';

/** Provenance: documented. POST /primaryorderquote/ request body. */
export const primaryOrderQuoteRequestSchema = z.object({
  wallet: z.string(),
  marketId: z.string(),
  side: sideWireSchema,
  /** Human-readable USDC; the API accepts a string or a number. */
  amountUsdc: z.union([z.string(), z.number()]),
  /** Attribution: tags the order for per-surface volume tracking. */
  userId: z.string().optional(),
});
export type PrimaryOrderQuoteRequest = z.infer<
  typeof primaryOrderQuoteRequestSchema
>;

/** Provenance: documented. POST /primaryorderquote/ response. */
export const primaryOrderQuoteResponseSchema = z.object({
  quoteId: z.string(),
  marketId: z.string(),
  side: sideWireSchema,
  amountUsdc: z.string(),
  shares: z.string(),
  avgPrice: z.string(),
  feeUsdc: z.string(),
  expiresAt: isoTimestampWireSchema,
  blockhashExpiryHintSec: z.number().int().optional(),
});
export type PrimaryOrderQuoteResponse = z.infer<
  typeof primaryOrderQuoteResponseSchema
>;

/** Provenance: documented. POST /primaryorderbuild/ request body. */
export const primaryOrderBuildRequestSchema = z.object({
  quoteId: z.string(),
  wallet: z.string(),
  userId: z.string().optional(),
  /** Default 100 (1%); maximum 5000. */
  maxSlippageBps: z.number().int().min(0).max(5000).optional(),
});
export type PrimaryOrderBuildRequest = z.infer<
  typeof primaryOrderBuildRequestSchema
>;

/** Provenance: documented. POST /primaryorderbuild/ response (instructions, not a tx). */
export const primaryOrderBuildResponseSchema = z.object({
  orderId: z.string(),
  quoteId: z.string(),
  wallet: z.string(),
  marketId: z.string(),
  side: sideWireSchema,
  amountUsdc: z.string(),
  expectedShares: z.string(),
  feeUsdc: z.string(),
  status: z.string(),
  instructions: z.array(rawInstructionSchema),
  derived: derivedAccountsWireSchema.optional(),
  recentBlockhash: z.string(),
  lastValidBlockHeight: z.number().int(),
  expiresAt: isoTimestampWireSchema,
  blockhashExpiryHintSec: z.number().int().optional(),
});
export type PrimaryOrderBuildResponse = z.infer<
  typeof primaryOrderBuildResponseSchema
>;

/** Provenance: documented. POST /primaryordersubmit/ request body. */
export const primaryOrderSubmitRequestSchema = z.object({
  orderId: z.string(),
  signature: z.string(),
  wallet: z.string().optional(),
});
export type PrimaryOrderSubmitRequest = z.infer<
  typeof primaryOrderSubmitRequestSchema
>;

/** Provenance: documented. POST /primaryordersubmit/ response. */
export const primaryOrderSubmitResponseSchema = z.object({
  orderId: z.string(),
  status: z.string(),
  signature: z.string(),
});
export type PrimaryOrderSubmitResponse = z.infer<
  typeof primaryOrderSubmitResponseSchema
>;

/** Provenance: documented. POST /primaryorderverify/ request body. */
export const primaryOrderVerifyRequestSchema = z.object({
  orderId: z.string(),
  signature: z.string().optional(),
  wallet: z.string().optional(),
});
export type PrimaryOrderVerifyRequest = z.infer<
  typeof primaryOrderVerifyRequestSchema
>;

/** Provenance: documented. POST /primaryorderverify/ response (note: number base units). */
export const primaryOrderVerifyResponseSchema = z.object({
  orderId: z.string(),
  status: z.enum(['built', 'submitted', 'confirmed', 'failed', 'expired']),
  signature: z.string().optional(),
  marketId: z.string().optional(),
  side: sideWireSchema.optional(),
  amountUsdc: baseUnitNumberWireSchema.optional(),
});
export type PrimaryOrderVerifyResponse = z.infer<
  typeof primaryOrderVerifyResponseSchema
>;
