/**
 * api — versioning, response envelopes, and rate-budget outcomes for the public
 * API other apps will call.
 *
 * Owns: the ApiVersion brand, versioned response envelopes, the stable
 * machine-readable error envelope, and the "budget exhausted" outcome type.
 * Must not import: domain modules or any framework.
 *
 * Designed for third parties: stable codes, a retryable flag, and explicit
 * per-app budget outcomes. The runtime that enforces budgets is out of scope
 * here (types only).
 */
import { z } from 'zod';

/** Known API versions. New versions are added here. */
export const API_VERSIONS = ['v1'] as const;

/** A versioned public API identifier. */
export const apiVersionSchema = z
  .literal('v1')
  .brand<'ApiVersion'>();
export type ApiVersion = z.infer<typeof apiVersionSchema>;

/** A response envelope for any endpoint other apps call. */
export interface VersionedResponse<T> {
  readonly apiVersion: ApiVersion;
  readonly data: T;
}

/** A stable, machine-readable error envelope for third-party consumers. */
export interface ApiErrorEnvelope {
  readonly apiVersion: ApiVersion;
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/** Which shared Panta rate budget an operation draws from. */
export type RateBudgetName = 'reads' | 'positions' | 'quotes' | 'builds';

/**
 * Outcome of a rate-budgeted call. `budget-exhausted` lets callers degrade
 * gracefully instead of hammering a shared 120/60/30/20 Panta budget.
 */
export type RateBudgetOutcome =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'budget-exhausted';
      readonly budget: RateBudgetName;
      readonly retryAfterSeconds: number;
    };
