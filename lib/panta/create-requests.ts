/**
 * panta/create-requests — the perimeter schemas for the create proxy routes.
 *
 * Owns: the Phase 4 validation applied to untrusted create-route bodies BEFORE
 * any adapter runs or any Panta request is made. Kept out of the route files so
 * the perimeter is unit-testable without importing a Next handler.
 * Must not import: React, Next, or any UI module.
 *
 * Phase 3 (wallet substitution): there is deliberately NO `wallet` field here.
 * The wallet is bound from the server session inside the route, and the top
 * level is a STRICT object — so a body that carries a `wallet` (or any other
 * unknown key) is rejected outright rather than silently ignored. The fee payer
 * cannot be redirected by whoever submits a draft.
 *
 * Phase 3 (state injection): the schedule is order-checked here as well as in
 * the domain validator, so an inverted draft is a clean 400 at the perimeter
 * instead of an upstream 4xx after the quote session is opened.
 */
import { z } from 'zod';
import {
  createIdSchema,
  marketCategorySlugSchema,
  marketTypeWireSchema,
  txSignatureSchema,
} from '@/types';

/**
 * The draft fields a create quote needs. The domain markers (`injection`,
 * `validated`, `resolvable`, `resolvability`) the wizard holds are stripped by
 * this non-strict object: they are never trusted and never forwarded.
 */
export const createQuoteDraftSchema = z
  .object({
    question: z.string().min(1).max(512),
    resolutionRule: z.string().min(1).max(2048),
    sourcesOfTruth: z.array(z.string().min(1).max(2048)).min(1).max(20),
    category: marketCategorySlugSchema,
    startTime: z.number().int().nonnegative(),
    endTime: z.number().int().nonnegative(),
    resolutionTime: z.number().int().nonnegative(),
    marketType: marketTypeWireSchema.optional(),
    eventInProgress: z.boolean().optional(),
    title: z.string().max(512).optional(),
    description: z.string().max(4096).optional(),
    region: z.string().max(128).optional(),
  })
  .refine((draft) => draft.startTime < draft.endTime, {
    path: ['startTime'],
    message: 'startTime must be before endTime',
  })
  .refine((draft) => draft.endTime <= draft.resolutionTime, {
    path: ['endTime'],
    message: 'endTime must be at or before resolutionTime',
  });

/** POST /api/panta/create/quote body. Strict: no wallet, no unknown keys. */
export const createQuoteBodySchema = z.strictObject({
  draft: createQuoteDraftSchema,
  // The wire contract requires a public http(s) URL, max 2048 chars: a data:
  // URL (including our locally templated SVG cover) is refused at the perimeter.
  imageUrl: z
    .string()
    .max(2048)
    .refine((value) => /^https?:\/\//.test(value), 'imageUrl must be http(s)'),
});

/** POST /api/panta/create/build body. Strict: only the create session id. */
export const createBuildBodySchema = z.strictObject({
  createId: createIdSchema,
});

/**
 * POST /api/panta/create/register body — the create session id and the wallet's
 * signature over the transaction Panta built for it.
 *
 * Phase 3 (wallet substitution): like the quote and build bodies, there is
 * deliberately NO `wallet` field, and the object is STRICT. Register's upstream
 * contract is `{ createId, signature }` and accepts no wallet either, so there
 * is nothing here a caller could use to redirect whose market gets created: the
 * `createId` was already bound to a wallet when the quote that produced it was
 * requested with `auth.wallet`.
 *
 * Both fields are branded on the way in. A `signature` that is not base58 of
 * plausible signature length, or a `createId` that is not one of ours, is a 400
 * at the perimeter — the route never calls Panta to find that out.
 */
export const createRegisterBodySchema = z.strictObject({
  createId: createIdSchema,
  signature: txSignatureSchema,
});

/** POST /api/sources/verify body — the SSRF-guarded reachability check. */
export const sourceVerifyBodySchema = z.strictObject({
  url: z.string().min(1).max(2048),
});

export type CreateQuoteBody = z.infer<typeof createQuoteBodySchema>;
export type CreateBuildBody = z.infer<typeof createBuildBodySchema>;
export type CreateRegisterBody = z.infer<typeof createRegisterBodySchema>;
export type CreateQuoteDraftBody = z.infer<typeof createQuoteDraftSchema>;
