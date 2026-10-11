/**
 * draft — the LLM draft pipeline.
 *
 * Owns: RawDraft (hostile, untrusted LLM output), ValidatedDraft (passes the
 * Panta field constraints), ResolvableDraft (passes the resolvability check),
 * the validator functions that are the only way to reach later stages, and the
 * typed ResolvabilityReport.
 * Must not import: adapters, network, or any framework. Pure only.
 *
 * Enforced ordering: a later stage can only be constructed by a validator. The
 * `validated` / `resolvable` marker fields make an earlier stage structurally
 * unusable where a later one is required.
 */
import { z } from 'zod';
import { err, ok, type Result } from './result';
import {
  MIN_STANDARD_LEAD_SECONDS,
  meetsStandardLead,
  startOfUnixDay,
  unixSecondsSchema,
  type UnixSeconds,
} from './time';

/** Prompt-injection flags carried on every raw draft. */
export interface PromptInjectionFlags {
  readonly suspicious: boolean;
  readonly reasons: readonly string[];
}

/** One per-field validation failure. */
export interface DraftFieldError {
  readonly field: string;
  readonly message: string;
}

/** A draft validation failure, with per-field detail. */
export interface DraftValidationError {
  readonly kind: 'validation';
  readonly errors: readonly DraftFieldError[];
}

/** The shape we expect from the LLM (before injection scanning). */
export const llmDraftSchema = z.object({
  question: z.string(),
  resolutionRule: z.string(),
  sourcesOfTruth: z.array(z.string()),
  category: z.string(),
  startTime: z.number().int(),
  endTime: z.number().int(),
  resolutionTime: z.number().int(),
  imageUrl: z.string().optional(),
  marketType: z.enum(['standard', 'breaking']).optional(),
  eventInProgress: z.boolean().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  region: z.string().optional(),
});
export type LlmDraft = z.infer<typeof llmDraftSchema>;

/** Untrusted LLM output. Treat every string as hostile. */
export interface RawDraft extends LlmDraft {
  readonly injection: PromptInjectionFlags;
}

/** A draft that passed the Panta field constraints. */
export interface ValidatedDraft extends RawDraft {
  readonly validated: true;
}

/** A typed explanation for why a draft is or is not resolvable. */
export interface ResolvabilityReport {
  readonly resolvable: boolean;
  readonly reasons: readonly string[];
  readonly suggestions: readonly string[];
}

/** A draft that passed both field validation and the resolvability check. */
export interface ResolvableDraft extends ValidatedDraft {
  readonly resolvable: true;
  readonly resolvability: ResolvabilityReport;
}

/** Context the validators need (available categories and the current time). */
export interface DraftValidationContext {
  readonly categories: readonly string[];
  readonly now: UnixSeconds;
}

const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore (all )?(previous|above) instructions/i,
  /disregard (the )?(previous|above|system)/i,
  /system prompt/i,
  /you are now/i,
];

/**
 * Parse untrusted LLM output into a RawDraft, scanning for prompt injection.
 * Never throws: malformed output becomes a Result error.
 */
export function parseRawDraft(
  input: unknown,
): Result<RawDraft, DraftValidationError> {
  const parsed = llmDraftSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      kind: 'validation',
      errors: [{ field: '$', message: 'draft does not match the expected shape' }],
    });
  }
  const data = parsed.data;
  const reasons = INJECTION_PATTERNS.filter(
    (pattern) => pattern.test(data.question) || pattern.test(data.resolutionRule),
  ).map((pattern) => pattern.source);
  return ok({
    ...data,
    injection: { suspicious: reasons.length > 0, reasons },
  });
}

/** The only way to reach a ValidatedDraft. */
export function validateDraft(
  raw: RawDraft,
  context: DraftValidationContext,
): Result<ValidatedDraft, DraftValidationError> {
  const errors: DraftFieldError[] = [];

  if (raw.question.length === 0 || raw.question.length > 512) {
    errors.push({ field: 'question', message: 'question must be 1..512 characters' });
  }
  if (raw.resolutionRule.length === 0 || raw.resolutionRule.length > 2048) {
    errors.push({ field: 'resolutionRule', message: 'resolutionRule must be 1..2048 characters' });
  }

  const sources = raw.sourcesOfTruth.map((source) => source.trim()).filter((s) => s.length > 0);
  if (sources.length === 0 || sources.length > 20) {
    errors.push({ field: 'sourcesOfTruth', message: 'need 1..20 non-empty sources' });
  }

  if (!context.categories.includes(raw.category)) {
    errors.push({ field: 'category', message: `category "${raw.category}" is not in the known list` });
  }

  if (!(raw.startTime < raw.endTime)) {
    errors.push({ field: 'startTime', message: 'startTime must be before endTime' });
  }
  if (!(raw.endTime <= raw.resolutionTime)) {
    errors.push({ field: 'endTime', message: 'endTime must be at or before resolutionTime' });
  }

  const start = unixSecondsSchema.safeParse(raw.startTime);
  if (!start.success) {
    errors.push({ field: 'startTime', message: 'startTime must be a non-negative integer' });
  } else {
    // Phase 3 (past-date injection): a market may never OPEN on a day before
    // today — regardless of market type. The wizard's date input and min attr
    // are UX; this unconditional day check is the authoritative wall, so an
    // LLM or crafted draft that lands on a previous day is rejected here.
    if (startOfUnixDay(start.data) < startOfUnixDay(context.now)) {
      errors.push({ field: 'startTime', message: 'start date must not be before today' });
    }
    const usesBreaking = raw.marketType === 'breaking' && raw.eventInProgress === true;
    if (!usesBreaking && !meetsStandardLead(start.data, context.now)) {
      errors.push({
        field: 'startTime',
        message: `standard markets must start at least ${MIN_STANDARD_LEAD_SECONDS}s from now`,
      });
    }
  }

  if (errors.length > 0) return err({ kind: 'validation', errors });
  return ok({ ...raw, sourcesOfTruth: sources, validated: true });
}

/** The only way to reach a ResolvableDraft. */
export function checkResolvable(
  draft: ValidatedDraft,
): Result<ResolvableDraft, ResolvabilityReport> {
  const reasons: string[] = [];
  const suggestions: string[] = [];

  const publicSources = draft.sourcesOfTruth.filter((source) => /^https?:\/\//.test(source));
  if (publicSources.length === 0) {
    reasons.push('no public http(s) source of truth');
    suggestions.push('add at least one public URL that states the outcome');
  }
  if (draft.resolutionRule.trim().length < 20) {
    reasons.push('resolution rule is too short to be unambiguous');
    suggestions.push('describe exactly what resolves YES vs NO, with a date');
  }

  const report: ResolvabilityReport = {
    resolvable: reasons.length === 0,
    reasons,
    suggestions,
  };
  return reasons.length === 0
    ? ok({ ...draft, resolvable: true, resolvability: report })
    : err(report);
}
