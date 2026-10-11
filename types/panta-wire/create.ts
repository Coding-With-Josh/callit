/**
 * panta-wire/create — the market-creation lifecycle wire schemas.
 *
 * Owns: image-upload, create quote, create build and register request/response
 * shapes.
 * Must not import: domain modules. Raw shapes only.
 *
 * Money rule: the create fee fields are USDC BASE UNITS as integer strings
 * ("50000000" = 50 USDC) — NOT human decimals. The quote's `paymentUsdc` is the
 * only fee authority; converted to a decimal UsdcDecimal at the transport edge.
 *
 * `oracle` is deliberately NOT modelled: the quote overview lists it as an
 * optional field, but the auth guide's "Do not send" table says oracle feed
 * identifiers are derived server-side. We send neither; Panta derives it.
 */
import { z } from 'zod';
import {
  baseUnitStringWireSchema,
  derivedAccountsWireSchema,
  isoTimestampWireSchema,
  marketCategorySlugSchema,
  marketTypeWireSchema,
} from './common';

/**
 * Provenance: documented + reconciled against live. The docs describe the signed
 * fields as a nested `fields` object; the live (sandbox) response returns the
 * same Cloudinary fields FLATTENED (cloudName/apiKey/timestamp/folder/signature)
 * with a non-functional `uploadUrl`. Both shapes parse here. Append every
 * recognized field plus `file` when posting to `uploadUrl` (see P5b).
 */
const uploadFieldValue = z.union([z.string(), z.number()]);

export const imageUploadResponseSchema = z.object({
  uploadUrl: z.string(),
  publicId: z.string().optional(),
  public_id: z.string().optional(),
  expiresAt: isoTimestampWireSchema.optional(),
  /** Documented form: signed fields nested in `fields`. */
  fields: z.record(z.string(), uploadFieldValue).optional(),
  /** Live (sandbox) form: the same fields flattened onto the response. */
  cloudName: z.string().optional(),
  apiKey: z.string().optional(),
  timestamp: uploadFieldValue.optional(),
  folder: z.string().optional(),
  signature: z.string().optional(),
  disclaimer: z.string().optional(),
});
export type ImageUploadResponse = z.infer<typeof imageUploadResponseSchema>;

/** Provenance: documented. POST /markets/create/quote/ request body. */
export const createQuoteRequestSchema = z.object({
  wallet: z.string(),
  question: z.string().min(1).max(512),
  resolutionRule: z.string().min(1).max(2048),
  sourcesOfTruth: z.array(z.string()).min(1).max(20),
  category: marketCategorySlugSchema,
  startTime: z.number().int(),
  endTime: z.number().int(),
  resolutionTime: z.number().int(),
  /**
   * Required, catalog-only. Must be a public http(s) URL (data URLs, signed
   * URLs and private hosts are rejected); max 2048 chars.
   */
  imageUrl: z
    .string()
    .max(2048)
    .refine((value) => /^https?:\/\//.test(value), 'imageUrl must be http(s)'),
  marketType: marketTypeWireSchema.optional(),
  eventInProgress: z.boolean().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  region: z.string().optional(),
});
export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

/** Provenance: documented. POST /markets/create/quote/ response. */
export const createQuoteResponseSchema = z.object({
  createId: z.string(),
  expectedEventPda: z.string(),
  paymentUsdc: baseUnitStringWireSchema,
  liquidityInjectionUsdc: baseUnitStringWireSchema,
  platformRevenueUsdc: baseUnitStringWireSchema,
  marketType: marketTypeWireSchema.optional(),
  expiresAt: isoTimestampWireSchema,
  blockhashExpiryHintSec: z.number().int().optional(),
});
export type CreateQuoteResponse = z.infer<typeof createQuoteResponseSchema>;

/** Provenance: documented. POST /markets/create/build/ request body. */
export const createBuildRequestSchema = z.object({
  createId: z.string(),
  /** If set, must equal the wallet from quote (docs). */
  wallet: z.string().optional(),
});
export type CreateBuildRequest = z.infer<typeof createBuildRequestSchema>;

/**
 * Provenance: documented, reconciled against live. The docs example includes
 * `createId` and the fee fields, but the live (sandbox) build response OMITS
 * them; both are optional here. `transaction` is required — an empty string
 * still parses (the adapter rejects it, since there is then nothing to sign).
 */
export const createBuildResponseSchema = z.object({
  createId: z.string().optional(),
  expectedEventPda: z.string().optional(),
  transaction: z.string(),
  recentBlockhash: z.string(),
  lastValidBlockHeight: z.number().int(),
  blockhashExpiryHintSec: z.number().int().optional(),
  buildFingerprint: z.string(),
  paymentUsdc: baseUnitStringWireSchema.optional(),
  liquidityInjectionUsdc: baseUnitStringWireSchema.optional(),
  platformRevenueUsdc: baseUnitStringWireSchema.optional(),
  marketType: marketTypeWireSchema.optional(),
  derived: derivedAccountsWireSchema.optional(),
  expiresAt: isoTimestampWireSchema,
});
export type CreateBuildResponse = z.infer<typeof createBuildResponseSchema>;

/** Provenance: documented. POST /markets/register/ request body. */
export const registerRequestSchema = z.object({
  createId: z.string(),
  signature: z.string(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** Provenance: documented. POST /markets/register/ response. */
export const registerResponseSchema = z.object({
  createId: z.string(),
  marketId: z.string(),
  status: z.string(),
  signature: z.string(),
  category: z.string(),
  title: z.string(),
  images: z.array(z.string()),
});
export type RegisterResponse = z.infer<typeof registerResponseSchema>;
