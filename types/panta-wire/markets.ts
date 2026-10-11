/**
 * panta-wire/markets — categories, market-list query, and market read models.
 *
 * Owns: the wire schemas for GET /categories/, GET /markets/ and
 * GET /markets/{id}/. Prices are nullable in the list and filled in the detail.
 * Must not import: domain modules. Raw shapes only.
 */
import { z } from 'zod';
import {
  cursorSchema,
  marketCategorySlugSchema,
  marketPhaseWireSchema,
  marketTimeWireSchema,
  marketTypeWireSchema,
} from './common';

/**
 * An optional sandbox notice. The live pk_test API returns this on every
 * response; a caller must surface it so sandbox data is never shown as live.
 */
const disclaimerFieldSchema = z.string().optional();

/** Provenance: documented. GET /categories/ -> { categories: string[] }. */
export const categoriesResponseSchema = z.object({
  categories: z.array(z.string()),
  disclaimer: disclaimerFieldSchema,
});
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;

/**
 * Provenance: documented. GET /markets/ query params. NOTE: the docs describe a
 * phase filter as `phase` but the example uses `status=primary`; both are
 * accepted here until a live call settles it.
 */
export const marketListQuerySchema = z.object({
  category: marketCategorySlugSchema.optional(),
  phase: marketPhaseWireSchema.optional(),
  status: z.string().optional(),
  createdBy: z.literal('me').optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type MarketListQuery = z.infer<typeof marketListQuerySchema>;

/**
 * Provenance: documented. A market as returned by Panta (same item shape for
 * list and detail). Prices are `null` in list rows and filled on detail.
 */
export const marketWireSchema = z.object({
  marketId: z.string(),
  category: z.string(),
  title: z.string(),
  description: z.string(),
  images: z.array(z.string()),
  phase: marketPhaseWireSchema,
  marketType: marketTypeWireSchema,
  startTime: marketTimeWireSchema,
  endTime: marketTimeWireSchema,
  resolutionTime: marketTimeWireSchema,
  region: z.string(),
  resolved: z.boolean(),
  status: z.string(),
  volumeUsdc: z.string(),
  campaignId: z.string().nullable(),
  createdByPartner: z.boolean(),
  yesPrice: z.string().nullable(),
  noPrice: z.string().nullable(),
  primaryYesPrice: z.string().nullable(),
  primaryNoPrice: z.string().nullable(),
  secondaryYesPrice: z.string().nullable(),
  secondaryNoPrice: z.string().nullable(),
  // Additive fields the live detail endpoint returns; optional so the list
  // shape (which omits them) still parses.
  creatorAddress: z.string().optional(),
  onChain: z.unknown().nullable().optional(),
  disclaimer: disclaimerFieldSchema,
});
export type MarketWire = z.infer<typeof marketWireSchema>;

/** Provenance: documented. GET /markets/ -> { items, nextCursor? }. */
export const marketListResponseSchema = z.object({
  items: z.array(marketWireSchema),
  nextCursor: z.string().nullable().optional(),
  disclaimer: disclaimerFieldSchema,
});
export type MarketListResponse = z.infer<typeof marketListResponseSchema>;

/** Provenance: documented. GET /markets/{id}/ -> a single (price-filled) market. */
export const marketDetailResponseSchema = marketWireSchema;
export type MarketDetailResponse = MarketWire;
