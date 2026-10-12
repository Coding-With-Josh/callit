/**
 * create/client — the client-side schema boundary for the create proxy routes.
 *
 * Owns: turning the JSON our own routes return into the domain `CreateQuote` /
 * `CreateBuild` / source verdict, and the fixed user copy for a failed create
 * request. Every parse is strict — an unexpected shape is a refusal, never a
 * partially-trusted object handed to the signer.
 * Must not import: React, Next, or any server module.
 *
 * Phase 1 (complete mediation): nothing in here grants authority. The parsed
 * values are operands for the pipeline (which re-checks stages) and for the
 * signer gate (which re-checks the sole signer), not permissions.
 *
 * Phase 2 (no internals leak): a route's response body is only ever parsed, and
 * every message this module produces is fixed copy. An upstream string cannot
 * travel through here into the UI.
 */
import { z } from 'zod';
import {
  createIdSchema,
  eventPdaSchema,
  marketIdSchema,
  unixSecondsSchema,
  unsignedTransactionB64Schema,
  usdcDecimalSchema,
  type CreateBuild,
  type CreateQuote,
  type MarketId,
} from '@/types';
import type { SourceVerification } from '@/lib/create-market';

/**
 * The domain quote as it crosses our own JSON route. Branded schemas validate
 * each field on the way in, so a route that echoed a malformed create id or a
 * negative expiry would fail here rather than reach the signer.
 */
const createQuoteResponseSchema = z.object({
  createId: createIdSchema,
  expectedEventPda: eventPdaSchema,
  paymentUsdc: usdcDecimalSchema,
  liquidityInjectionUsdc: usdcDecimalSchema,
  platformRevenueUsdc: usdcDecimalSchema,
  expiresAt: unixSecondsSchema,
});

/**
 * The domain build as it crosses our own JSON route. `transaction` is the only
 * thing that will be signed, and the blockhash window is what the pipeline
 * re-checks before prompting the wallet.
 */
const createBuildResponseSchema = z.object({
  transaction: unsignedTransactionB64Schema,
  recentBlockhash: z.string().min(1),
  lastValidBlockHeight: z.number().int().nonnegative(),
  buildExpiresAt: unixSecondsSchema,
});

/**
 * The verdict shape the source-verify route returns.
 *
 * Strict by design (Phase 3): an `ok` verdict MUST carry a tier. Tolerating a
 * bare `{ ok: true }` would read an unconfirmed result as confirmed if the route
 * ever stopped sending the tier — i.e. it would silently skip the attestation
 * the user is supposed to give. An unrecognised shape is a refusal instead.
 * `reason` is bounded: it is fixed copy from our own verifier, and a compromised
 * route must not be able to push an unbounded string into the UI.
 */
const sourceVerdictResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    confidence: z.enum(['confirmed', 'unconfirmed']),
    reason: z.string().max(300).optional(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.string().max(300).optional(),
  }),
]);

/**
 * A malformed create payload. Carries fixed copy only — the zod issue tree can
 * quote the rejected input, so it is never surfaced (Phase 2).
 */
export class CreateClientError extends Error {
  constructor(message = 'The create response could not be read.') {
    super(message);
    this.name = 'CreateClientError';
  }
}

export function parseCreateQuote(data: unknown): CreateQuote {
  const parsed = createQuoteResponseSchema.safeParse(data);
  if (!parsed.success) throw new CreateClientError();
  return parsed.data;
}

export function parseCreateBuild(data: unknown): CreateBuild {
  const parsed = createBuildResponseSchema.safeParse(data);
  if (!parsed.success) throw new CreateClientError();
  return parsed.data;
}

/**
 * The register route's response: the market id, and nothing else.
 *
 * Strict on purpose. Register is the money step, so a success must be proven by
 * a plausible market id — a route that answered `{}` or a stray string must fail
 * here rather than let the UI announce a market that does not exist. This is
 * also the reason the schema is an object rather than a bare string: it leaves
 * room to add a field (say, a confirmation status) without the client silently
 * accepting the old shape.
 */
const createRegisterResponseSchema = z.object({
  marketId: marketIdSchema,
});

export function parseCreateRegister(data: unknown): MarketId {
  const parsed = createRegisterResponseSchema.safeParse(data);
  if (!parsed.success) throw new CreateClientError();
  return parsed.data.marketId;
}

/**
 * Phase 2 (fail closed): an unreadable verdict is a FAILED check, never a pass —
 * the same direction the server-side verifier fails in.
 */
export function parseSourceVerdict(data: unknown): SourceVerification {
  const parsed = sourceVerdictResponseSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, reason: 'The source check returned an unreadable result.' };
  }
  if (parsed.data.ok) {
    return parsed.data.confidence === 'unconfirmed'
      ? {
          ok: true,
          confidence: 'unconfirmed',
          reason:
            parsed.data.reason ??
            'the site refuses automated checks, so this page could not be read',
        }
      : { ok: true, confidence: 'confirmed' };
  }
  return { ok: false, reason: parsed.data.reason ?? 'The source could not be reached.' };
}

/**
 * Fixed user copy for a FAILED source-check request, keyed by the route status.
 *
 * Phase 2 (no internals leak): the response body is never read; only the number
 * is used. This exists because collapsing every status into one sentence made a
 * missing route (404) indistinguishable from an upstream 5xx — the wizard showed
 * "could not be checked right now" for both, and the real cause was invisible.
 */
export function describeSourceCheckError(status: number): string {
  if (status === 0) return 'Source checking could not be reached.';
  // Not "sign in again": the usual case is a draft step reached before any
  // wallet connection (the session mint lives in the header wallet pill), and
  // the remedy is the same either way — this points at the control next to it.
  if (status === 401 || status === 403) return 'Connect your wallet to check sources.';
  if (status === 400) return 'That source URL could not be checked.';
  if (status === 404) return 'Source checking is not available right now.';
  if (status === 429) return 'Too many source checks — wait a moment and try again.';
  if (status >= 500) return 'Source checking is temporarily unavailable.';
  return 'The source could not be checked right now.';
}

/** Fixed user copy keyed by the route's HTTP status. Never the response body. */
export function describeCreateClientError(status: number): string {
  if (status === 401 || status === 403) return 'Sign in to continue.';
  if (status === 400) return "That draft isn't valid for a market. Check the fields and try again.";
  if (status === 404) return 'That create session is no longer available.';
  if (status === 409) return 'Panta refused this market. Change the claim or the schedule and try again.';
  if (status === 422) return "Panta can't quote this market as written. Adjust the resolution rule or the sources.";
  if (status === 429) return 'Too many requests — wait a moment and try again.';
  // 502 is this app's wrapper around an upstream Panta failure — including
  // Panta rejecting OUR credentials, which is never the caller's session.
  if (status === 502) return 'Market creation is temporarily unavailable.';
  if (status === 503) return 'Market creation is temporarily unavailable.';
  if (status === 504) return "Panta didn't respond in time.";
  return 'The create request could not be completed.';
}

/**
 * Fixed user copy for a failed REGISTER, keyed by the route's own status.
 *
 * Register needs its own copy because the shared create copy is actively wrong
 * here. `describeCreateClientError(400)` says "that draft isn't valid for a
 * market. Check the fields and try again." — but register's request has no
 * fields to check, and by this stage the draft is settled: the transaction is
 * already signed. Pointing the user at the draft would send them to edit a claim
 * that was never the problem.
 *
 * The single most important property of this copy is that it never claims the
 * money did NOT move unless that is certain. Register can fail in ways where the
 * submission's fate is genuinely unknown (a timeout, or an upstream 5xx after
 * the request was accepted), and Panta's own "createId not found or already
 * consumed" cannot distinguish "never submitted" from "already created" — in the
 * second case the market exists and the fee WAS charged. So:
 *
 *   - a failure where nothing was submitted says so plainly and offers a retry;
 *   - a failure that is unconfirmed says "couldn't confirm" and sends the user
 *     to look at their markets before retrying, rather than reassuring them.
 *
 * Retrying is nonetheless safe by construction: the `createId` is single-use
 * upstream, so a retry that is not needed is refused rather than duplicated.
 */
export function describeRegisterClientError(status: number): string {
  // 401/403 is OUR session guard: an upstream auth failure is mapped to 502
  // before it can reach here, so this one really is about the user's session.
  if (status === 401 || status === 403) return 'Sign in to continue.';
  // Our perimeter refused the body, or Panta refused the submission outright
  // (e.g. a signature that does not match). Nothing was submitted, and a failed
  // submission does not consume the create session, so a retry is safe to offer.
  if (status === 400) {
    return 'The submission was refused, so nothing was submitted. You can try again.';
  }
  // The create session is finished: gone, or already consumed by an earlier
  // successful register. We cannot tell which, so we must not assert that
  // nothing was charged — a market may exist and the fee may have moved.
  if (status === 409) {
    return 'This create session was already used or has expired. If you signed it, check your markets first — a market may have been created.';
  }
  if (status === 429) return 'Too many requests — wait a moment and try again.';
  // 410: Panta holds no transaction for this create session — it was never
  // built, or the built blockhash expired (the live hint is ~60s). It cannot
  // have submitted something it does not hold, so nothing was charged; but
  // retrying the SAME signature would fail identically, because the transaction
  // itself is gone. The copy has to say "rebuild", not "try again".
  if (status === 410) {
    return 'Panta no longer has this transaction, so nothing was submitted. Go back to the draft and build it again.';
  }
  // 502 (upstream failure, network failure, or Panta rejecting our key) and 504
  // (timeout) are both UNCONFIRMED: the request may have been accepted before
  // the connection broke. Never reassure; send the user to their own record.
  if (status === 502 || status === 503 || status === 504 || status === 0) {
    return "We couldn't confirm the submission. Check your markets before trying again — a market may have been created.";
  }
  return 'The market could not be submitted.';
}
