/**
 * panta-wire/common — shared raw Panta wire primitives.
 *
 * Owns: the parts of Panta's wire contract shared across endpoints (raw
 * instructions, side/phase/market-type enums, the category allowlist, and the
 * unit- and time-carrying schemas) plus the schema-provenance tag.
 * Must not import: domain modules (market/buy/create/ledger). This folder is
 * the single place a Panta API change should touch.
 *
 * Provenance tags: `documented` (stated in the official docs), `unverified`
 * (shape not confirmed), `live-confirmed` (confirmed against a live response —
 * reserved; unused for now). Every schema here is `documented` against
 * https://docs.panta.market; none has been checked against a live response yet.
 */
import { z } from 'zod';

/** Where a wire schema's shape came from. */
export type SchemaProvenance = 'documented' | 'unverified' | 'live-confirmed';

/** How certain we are about each response schema. */
export const WIRE_SCHEMA_PROVENANCE = {
  categoriesResponse: 'documented',
  marketWire: 'documented',
  marketListResponse: 'documented',
  marketListQuery: 'documented',
  rawInstruction: 'documented',
  imageUploadResponse: 'documented',
  createQuoteResponse: 'documented',
  createBuildResponse: 'documented',
  registerResponse: 'documented',
  primaryOrderQuoteResponse: 'documented',
  primaryOrderBuildResponse: 'documented',
  primaryOrderSubmitResponse: 'documented',
  primaryOrderVerifyResponse: 'documented',
  claimBuildResponse: 'documented',
  creatorFeesBuildResponse: 'documented',
  tradeReportResponse: 'documented',
  tradeStatusResponse: 'documented',
  positionsResponse: 'documented',
  accountMetricsResponse: 'documented',
} as const satisfies Record<string, SchemaProvenance>;

/** Which side of a binary market: yes or no. */
export const sideWireSchema = z.enum(['yes', 'no']);
export type SideWire = z.infer<typeof sideWireSchema>;

/** Market phase as returned by Panta. */
export const marketPhaseWireSchema = z.enum([
  'primary',
  'secondary',
  'resolved',
  'cancelled',
]);
export type MarketPhaseWire = z.infer<typeof marketPhaseWireSchema>;

/** Market type as returned by Panta. */
export const marketTypeWireSchema = z.enum(['standard', 'breaking']);
export type MarketTypeWire = z.infer<typeof marketTypeWireSchema>;

/**
 * The allowlist of market-category SLUGS (lowercase). The single source for the
 * create-quote body and the market-list filter. Docs: GET /categories/.
 *
 * This is a closed allowlist: an unknown category is rejected here (fail closed)
 * rather than being sent to Panta only to bounce back INVALID_MARKET_PARAMS
 * (Phase 3: category over-permissiveness).
 */
export const MARKET_CATEGORY_SLUGS = [
  'sports',
  'crypto',
  'politics',
  'entertainment',
  'finance',
  'science',
  'world',
  'other',
] as const;
export const marketCategorySlugSchema = z.enum(MARKET_CATEGORY_SLUGS);
export type MarketCategorySlug = z.infer<typeof marketCategorySlugSchema>;

/** Provenance: documented. One account entry inside a raw instruction. */
export const rawInstructionAccountSchema = z.object({
  pubkey: z.string(),
  isSigner: z.boolean(),
  isWritable: z.boolean(),
});
export type RawInstructionAccount = z.infer<typeof rawInstructionAccountSchema>;

/**
 * Provenance: documented. A single instruction as returned by build endpoints.
 * `data` is base64. These instructions are Panta's and must never be modified.
 */
export const rawInstructionSchema = z.object({
  programId: z.string(),
  data: z.string(),
  accounts: z.array(rawInstructionAccountSchema),
});
export type RawInstruction = z.infer<typeof rawInstructionSchema>;

/** Provenance: documented. A cursor for paginated reads. */
export const cursorSchema = z.string();

/** Provenance: documented. A decimal string (primary-buy USDC fields, e.g. "20.00"). */
export const decimalWireSchema = z.string();

/**
 * Provenance: documented. A base-unit integer NUMBER (the verify endpoint's
 * quirk — it returns base units as a number, unlike quote/build strings).
 * `.int()` rejects NaN/Infinity/non-integers; `.nonnegative()` rejects sign.
 */
export const baseUnitNumberWireSchema = z.number().int().nonnegative();

/**
 * Provenance: documented. A USDC base-unit integer STRING, e.g. "50000000" =
 * 50 USDC. Create-market fees and creator-fee amounts use this format, unlike
 * the human-decimal strings primary buy uses.
 *
 * The integer-string shape is the guard (Phase 3: money unit confusion): a
 * decimal like "50.00" is rejected, so a base-unit/decimal mix-up can never be
 * parsed silently as a much larger fee.
 */
export const baseUnitStringWireSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'expected an integer string of USDC base units');

/**
 * Provenance: documented. An ISO-8601 timestamp as Panta returns it, e.g.
 * "2026-09-04T16:30:00.000000Z". Panta emits microsecond (6-digit) fractional
 * seconds, which z.iso.datetime()'s default precision rejects, so this accepts
 * 0–9 fractional digits and either `Z` or a numeric offset. The value is
 * converted to UnixSeconds only at the transport boundary (Phase 3: timestamp
 * unit confusion).
 */
export const isoTimestampWireSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/,
    'expected an ISO-8601 timestamp',
  );

/** Provenance: documented. Unix seconds. */
export const unixSecondsWireSchema = z.number().int();

/**
 * A market timestamp. The docs type these as unix integers, but the live API
 * (pk_test) returns ISO-8601 strings; accept BOTH and normalize at the
 * transport boundary so neither shape breaks a read.
 */
export const marketTimeWireSchema = z.union([
  unixSecondsWireSchema,
  isoTimestampWireSchema,
]);
export type MarketTimeWire = z.infer<typeof marketTimeWireSchema>;

/**
 * A safe `derived` account key: a plain identifier that is not a prototype
 * key. `__proto__` fails the leading-letter rule; `constructor`/`prototype`
 * are excluded explicitly (Phase 3: prototype pollution via untrusted keys).
 */
const SAFE_DERIVED_KEY = /^(?!constructor$|prototype$)[A-Za-z][A-Za-z0-9_]*$/;

/** Provenance: documented. A key of a build response's `derived` account map. */
export const derivedAccountKeySchema = z
  .string()
  .regex(SAFE_DERIVED_KEY, 'derived keys must be safe identifiers');

/**
 * Provenance: documented. An account-address map returned by build endpoints.
 *
 * Guarded in two steps: zod v4's `z.record` SILENTLY DROPS a `__proto__` key
 * before any key schema runs (verified against zod 4.6.5), so a record-only
 * guard can neither see nor reject it. We therefore validate the RAW input's
 * own keys first — where `__proto__` is still present — and only then pipe into
 * the typed record. This *rejects* `__proto__`/`constructor`/`prototype`
 * instead of quietly dropping them (Phase 3: prototype pollution).
 */
export const derivedAccountsWireSchema = z
  .unknown()
  .superRefine((input, ctx) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      ctx.addIssue({ code: 'custom', message: 'expected a derived object' });
      return;
    }
    for (const key of Object.keys(input)) {
      if (!SAFE_DERIVED_KEY.test(key)) {
        ctx.addIssue({ code: 'custom', message: `unsafe derived key: ${key}` });
      }
    }
  })
  .pipe(z.record(derivedAccountKeySchema, z.string()));
export type DerivedAccounts = z.infer<typeof derivedAccountsWireSchema>;
