/**
 * compliance — obligations expressed as types where possible.
 *
 * Owns: the exact Panta badge string, the AsOf timestamp, DataProvenance, the
 * DisplayPrice (which cannot be built without an AsOf) and the FeeDisclosure.
 * Must not import: app-registry, ledger, or any framework.
 *
 * Honest limit: these types force *construction order* (you cannot build a
 * DisplayPrice or FeeDisclosure without the required fields). TypeScript cannot
 * force a screen to actually render the badge or the fee — that remains a
 * review obligation, stated in the README.
 */
import { z } from 'zod';
import type { Price, UsdcDecimal } from './money';

/** The exact required wording, near any Panta-powered surface. */
export const PANTA_BADGE = 'Powered by Panta' as const;

/** The literal badge string type. */
export type PantaBadge = typeof PANTA_BADGE;

/** Zod schema requiring exactly the badge string. */
export const pantaBadgeSchema = z.literal(PANTA_BADGE);

/** Copy that must carry the Panta badge. */
export interface BadgedCopy {
  readonly text: string;
  readonly badge: PantaBadge;
}

/** Build badged copy, always attaching the exact badge string. */
export function badgedCopy(text: string): BadgedCopy {
  return { text, badge: PANTA_BADGE };
}

/** A timestamp that must accompany any price or odds shown to a user. */
export const asOfSchema = z.iso.datetime().brand<'AsOf'>();
export type AsOf = z.infer<typeof asOfSchema>;

/** Parse an ISO string into an AsOf timestamp (throws on invalid input). */
export function asOf(iso: string): AsOf {
  return asOfSchema.parse(iso);
}

/** Where a value came from: real, cached, or a fixture. */
export const dataProvenanceSchema = z.enum(['live', 'cached', 'fixture']);
export type DataProvenance = z.infer<typeof dataProvenanceSchema>;

/** A price shown to a user. It cannot be constructed without an AsOf + provenance. */
export interface DisplayPrice {
  readonly amount: Price;
  readonly asOf: AsOf;
  readonly provenance: DataProvenance;
}

/** Construct a DisplayPrice. `asOf` and `provenance` are required by the type. */
export function displayPrice(
  amount: Price,
  asOf: AsOf,
  provenance: DataProvenance,
): DisplayPrice {
  return { amount, asOf, provenance };
}

/** A fee shown before a signing step. `shownAt` is required by the type. */
export interface FeeDisclosure {
  readonly kind: 'creation' | 'buy';
  readonly label: string;
  readonly amountUsdc: UsdcDecimal;
  readonly shownAt: AsOf;
}

/** Construct a FeeDisclosure to be rendered before the user signs. */
export function feeDisclosure(
  kind: 'creation' | 'buy',
  label: string,
  amountUsdc: UsdcDecimal,
  shownAt: AsOf,
): FeeDisclosure {
  return { kind, label, amountUsdc, shownAt };
}
