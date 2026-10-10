/**
 * create-market — app-side create pipeline service.
 *
 * A thin, fail-closed orchestrator over the domain contracts in types/draft.ts
 * and types/create.ts. It never re-implements a validator, never fabricates a
 * lifecycle stage, and never lets a step run until the legal-transition table
 * (types/create::CREATE_TRANSITIONS) allows it.
 *
 * I/O — LLM draft, categories, quote, build, sign, register, clock — goes
 * through `CreateAdapters`. The default `fixtureCreateAdapters` is a
 * clearly-labeled in-process stub (provenance "fixture"); the real HTTP wiring
 * (proxy routes behind X-Api-Key) drops into the same interface later without
 * touching the wizard.
 *
 * Money rule: the only fee authority is quote.paymentUsdc (compliance). This
 * module never invents a fee; the wizard's fee-disclosure row reads the quote.
 *
 * Honest limit (mirrors the domain's): a runtime caller could hand any step a
 * lifecycle object that satisfies the union shape. The steps check the *stage*
 * transition table, and the only practical producer of lifecycle objects is
 * this module — the wizard holds what this module returns. Construction-level
 * safety lives in types/; this file adds runtime stage discipline on top.
 */
import {
  beginCreate,
  canCreateTransition,
  checkResolvable,
  createIdSchema,
  err,
  eventPdaSchema,
  isExpired,
  marketId,
  ok,
  openCreateQuote,
  parseRawDraft,
  txSignature,
  unsignedTransactionB64Schema,
  unixSeconds,
  usdcDecimalSchema,
  validateDraft,
  type CreateBuild,
  type CreateLifecycle,
  type CreateQuote,
  type CreateStage,
  type DataProvenance,
  type DraftFieldError,
  type LlmDraft,
  type MarketId,
  type RawDraft,
  type ResolvabilityReport,
  type ResolvableDraft,
  type Result,
  type TxSignature,
  type UnixSeconds,
} from "@/types";

/** Typed failure for the pipeline. Adapter failures never throw through. */
export type CreateMarketError =
  | {
      readonly kind: "invalid_transition";
      readonly from: CreateStage;
      readonly to: CreateStage;
    }
  | { readonly kind: "validation"; readonly errors: readonly DraftFieldError[] }
  | { readonly kind: "unresolvable"; readonly report: ResolvabilityReport }
  | { readonly kind: "adapter"; readonly message: string };

/** Every external call the create flow makes. Swappable (fixture vs. HTTP). */
export interface CreateAdapters {
  /** Where data comes from — the wizard labels fees/preview with this. */
  readonly provenance: DataProvenance;
  /** LLM draft generation. Output is untrusted; draftFromClaim runs
   *  parseRawDraft (injection scan) on it before anything else. */
  readonly generateDraft: (claim: string) => Promise<LlmDraft>;
  /** Known categories, required by the domain validator. */
  readonly fetchCategories: () => Promise<readonly string[]>;
  /**
   * Upload the templated cover and return the PUBLIC http(s) imageUrl the quote
   * requires (the wire schema rejects data: URLs). The exact Panta
   * image-upload handshake (POST /markets/create/image-upload/ → storage) is
   * UNVERIFIED; the fixture stub returns a placeholder URL and the wizard shows
   * a locally-templated thumbnail, never presenting the fixture URL as live.
   */
  readonly uploadImage: (draft: LlmDraft) => Promise<string>;
  /** Create quote. paymentUsdc in the result is the fee authority. */
  readonly requestQuote: (
    draft: ResolvableDraft,
    imageUrl: string,
  ) => Promise<CreateQuote>;
  /** Build the unsigned Panta transaction. Opaque — never modified. */
  readonly buildCreate: (quote: CreateQuote) => Promise<CreateBuild>;
  /** Wallet signing hook. Returns the transaction signature. */
  readonly signCreate: (build: CreateBuild) => Promise<TxSignature>;
  /** Register the signed create; returns the on-chain market id. */
  readonly register: (
    quote: CreateQuote,
    signature: TxSignature,
  ) => Promise<MarketId>;
  /** Clock — injectable for deterministic tests. */
  readonly now: () => UnixSeconds;
}

function adapterMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "adapter call failed";
}

/**
 * Phase 3 (workflow bypass): the only runtime gate a step has — mirror the
 * domain's legal transition table. A step that isn't legal from the current
 * stage is rejected before any adapter is touched.
 */
function guardTransition(
  lifecycle: CreateLifecycle,
  to: CreateStage,
): CreateMarketError | null {
  if (canCreateTransition(lifecycle.status, to)) return null;
  return { kind: "invalid_transition", from: lifecycle.status, to };
}

// ─── Steps ───────────────────────────────────────────────────────────────────

/** Claim -> RawDraft via the LLM adapter, then beginCreate. Never throws. */
export async function draftFromClaim(
  claim: string,
  adapters: CreateAdapters,
): Promise<Result<CreateLifecycle, CreateMarketError>> {
  const trimmed = claim.trim();
  if (trimmed.length === 0) {
    // Fail closed before any adapter: empty claims never reach the LLM.
    return err({
      kind: "validation",
      errors: [{ field: "claim", message: "paste a claim to market-ify" }],
    });
  }
  let llm: LlmDraft;
  try {
    llm = await adapters.generateDraft(trimmed);
  } catch (error) {
    return err({ kind: "adapter", message: adapterMessage(error) });
  }
  // Phase 3 (prompt injection): parseRawDraft scans the hostile LLM output and
  // never throws. Its Result is the only way a draft enters the lifecycle.
  const parsed = parseRawDraft(llm);
  if (!parsed.ok) return err(parsed.error);
  return ok(beginCreate(parsed.value));
}

/** drafted -> validated (field constraints + category + lead time). */
export async function validateDraftStep(
  lifecycle: CreateLifecycle,
  adapters: CreateAdapters,
): Promise<Result<CreateLifecycle, CreateMarketError>> {
  const blocked = guardTransition(lifecycle, "validated");
  if (blocked) return err(blocked);
  if (lifecycle.status !== "drafted") {
    return err({
      kind: "invalid_transition",
      from: lifecycle.status,
      to: "validated",
    });
  }
  let categories: readonly string[];
  try {
    categories = await adapters.fetchCategories();
  } catch (error) {
    return err({ kind: "adapter", message: adapterMessage(error) });
  }
  const result = validateDraft(lifecycle.raw, {
    categories,
    now: adapters.now(),
  });
  if (!result.ok) return err(result.error);
  return ok({ status: "validated", draft: result.value });
}

/** validated -> resolvable (public source + unambiguous rule). Pure. */
export async function checkResolvabilityStep(
  lifecycle: CreateLifecycle,
): Promise<Result<CreateLifecycle, CreateMarketError>> {
  const blocked = guardTransition(lifecycle, "resolvable");
  if (blocked) return err(blocked);
  if (lifecycle.status !== "validated") {
    return err({
      kind: "invalid_transition",
      from: lifecycle.status,
      to: "resolvable",
    });
  }
  const result = checkResolvable(lifecycle.draft);
  if (!result.ok) {
    // Fail-closed: an unresolvable draft is surfaced to the user as a report.
    // There is no auto-pass path — editing the draft is the only way forward.
    return err({ kind: "unresolvable", report: result.error });
  }
  return ok({ status: "resolvable", draft: result.value });
}

/** resolvable -> quoted. The quote's paymentUsdc is the fee authority. */
export async function openQuoteStep(
  lifecycle: CreateLifecycle,
  adapters: CreateAdapters,
  imageUrl = "",
): Promise<Result<CreateLifecycle, CreateMarketError>> {
  const blocked = guardTransition(lifecycle, "quoted");
  if (blocked) return err(blocked);
  if (lifecycle.status !== "resolvable") {
    return err({
      kind: "invalid_transition",
      from: lifecycle.status,
      to: "quoted",
    });
  }
  const url = imageUrl.trim() || (lifecycle.draft.imageUrl ?? "");
  let quote: CreateQuote;
  try {
    quote = await adapters.requestQuote(lifecycle.draft, url);
  } catch (error) {
    return err({ kind: "adapter", message: adapterMessage(error) });
  }
  const now = adapters.now();
  if (isExpired(quote.expiresAt, now)) {
    // Phase 2 (stale data): an already-expired quote must not reach the
    // wallet. create_expired retries legally from resolvable.
    return ok({ status: "create_expired", at: now });
  }
  return ok(openCreateQuote(lifecycle.draft, url, quote));
}

/** quoted -> built (opaque Panta transaction; never modified). */
export async function buildStep(
  lifecycle: CreateLifecycle,
  adapters: CreateAdapters,
): Promise<Result<CreateLifecycle, CreateMarketError>> {
  const blocked = guardTransition(lifecycle, "built");
  if (blocked) return err(blocked);
  if (lifecycle.status !== "quoted") {
    return err({
      kind: "invalid_transition",
      from: lifecycle.status,
      to: "built",
    });
  }
  let build: CreateBuild;
  try {
    build = await adapters.buildCreate(lifecycle.quote);
  } catch (error) {
    return err({ kind: "adapter", message: adapterMessage(error) });
  }
  const now = adapters.now();
  if (isExpired(build.buildExpiresAt, now)) {
    return ok({ status: "create_expired", at: now });
  }
  return ok({
    status: "built",
    draft: lifecycle.draft,
    imageUrl: lifecycle.imageUrl,
    quote: lifecycle.quote,
    build,
  });
}

/** built -> signed. The wallet UI hooks in here via the adapter. */
export async function signStep(
  lifecycle: CreateLifecycle,
  adapters: CreateAdapters,
): Promise<Result<CreateLifecycle, CreateMarketError>> {
  const blocked = guardTransition(lifecycle, "signed");
  if (blocked) return err(blocked);
  if (lifecycle.status !== "built") {
    return err({
      kind: "invalid_transition",
      from: lifecycle.status,
      to: "signed",
    });
  }
  let signature: TxSignature;
  try {
    signature = await adapters.signCreate(lifecycle.build);
  } catch (error) {
    return err({ kind: "adapter", message: adapterMessage(error) });
  }
  return ok({
    status: "signed",
    draft: lifecycle.draft,
    imageUrl: lifecycle.imageUrl,
    quote: lifecycle.quote,
    build: lifecycle.build,
    signature,
    signedAt: adapters.now(),
  });
}

/** signed -> registered. Returns the on-chain market id. */
export async function registerStep(
  lifecycle: CreateLifecycle,
  adapters: CreateAdapters,
): Promise<Result<CreateLifecycle, CreateMarketError>> {
  const blocked = guardTransition(lifecycle, "registered");
  if (blocked) return err(blocked);
  if (lifecycle.status !== "signed") {
    return err({
      kind: "invalid_transition",
      from: lifecycle.status,
      to: "registered",
    });
  }
  let marketIdValue: MarketId;
  try {
    marketIdValue = await adapters.register(lifecycle.quote, lifecycle.signature);
  } catch (error) {
    return err({ kind: "adapter", message: adapterMessage(error) });
  }
  return ok({
    status: "registered",
    draft: lifecycle.draft,
    quote: lifecycle.quote,
    marketId: marketIdValue,
    registeredAt: adapters.now(),
  });
}

// ─── Draft revision + cover prep ─────────────────────────────────────────────

/** The user-editable fields of a draft (identity/times/rule/sources/category). */
export type DraftEdits = Partial<
  Pick<
    LlmDraft,
    | "question"
    | "resolutionRule"
    | "sourcesOfTruth"
    | "category"
    | "startTime"
    | "endTime"
    | "resolutionTime"
  >
>;

/**
 * Apply user edits to a raw draft and restart it at the `drafted` stage.
 *
 * Phase 1 (state machine): the transition table has no backward edge, so a
 * revision is modelled as a *fresh* draft — still unvalidated until the steps
 * run again. Lifecycle objects are constructed only here, never in the UI.
 */
export function editDraft(raw: RawDraft, edits: DraftEdits): CreateLifecycle {
  return beginCreate({ ...raw, ...edits });
}

/**
 * The invisible image step: template-from-question -> upload -> public URL.
 * Fail-closed: an upload failure is a typed adapter error, and the caller must
 * not open the quote without the returned URL (Phase 2).
 */
export async function uploadCoverStep(
  draft: LlmDraft,
  adapters: CreateAdapters,
): Promise<Result<string, CreateMarketError>> {
  try {
    const url = await adapters.uploadImage(draft);
    if (url.trim().length === 0) {
      return err({ kind: "adapter", message: "cover upload returned no URL" });
    }
    return ok(url);
  } catch (error) {
    return err({ kind: "adapter", message: adapterMessage(error) });
  }
}

// ─── Fixture adapters (stub; provenance "fixture") ───────────────────────────

const DAY = 86_400;

// Fixed clock so tests and preview are deterministic (not "now"-dependent).
const BASE_NOW = unixSeconds(1_790_000_000);

function futureUnix(days: number): UnixSeconds {
  return unixSeconds(BASE_NOW + days * DAY);
}

/**
 * In-process stub for the whole external surface. Everything here is
 * provenance "fixture" — the wizard must label it as preview, never live.
 * The LLM step is deliberately NOT the real LLM: per decision, the draft step
 * is a stub panel until the server-side LLM route exists.
 */
export const fixtureCreateAdapters: CreateAdapters = {
  provenance: "fixture",

  generateDraft: async (claim) => ({
    question: claim,
    resolutionRule: `Resolves to YES if "${claim}" is confirmed by a public source of truth by the resolution deadline; otherwise NO.`,
    sourcesOfTruth: ["https://fixture.example.com/source-of-truth"],
    category: "Crypto",
    startTime: BASE_NOW + 3 * DAY,
    endTime: BASE_NOW + 30 * DAY,
    resolutionTime: BASE_NOW + 31 * DAY,
    imageUrl: "https://fixture.example.com/cover.png",
    marketType: "standard",
    eventInProgress: false,
  }),

  fetchCategories: async () => [
    "Crypto",
    "Politics",
    "Sports",
    "Culture",
    "Tech",
    "Science",
    "World",
  ],

  // Stub upload: returns a placeholder public URL. The real flow uploads the
  // templated bytes and returns the storage URL (UNVERIFIED handshake).
  uploadImage: async () => "https://fixture.example.com/cover.png",

  requestQuote: async () => ({
    createId: createIdSchema.parse("fixture-create-1"),
    // "1"*32 is a valid 32-byte base58 address (all-zero key) — passes the PDA check.
    expectedEventPda: eventPdaSchema.parse("11111111111111111111111111111111"),
    paymentUsdc: usdcDecimalSchema.parse("50"),
    liquidityInjectionUsdc: usdcDecimalSchema.parse("15"),
    platformRevenueUsdc: usdcDecimalSchema.parse("2.5"),
    expiresAt: futureUnix(0.05), // ~72 minutes
  }),

  buildCreate: async () => ({
    transaction: unsignedTransactionB64Schema.parse("SGVsbG8gUGFudGE="),
    recentBlockhash: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    lastValidBlockHeight: 300_000_000,
    buildExpiresAt: futureUnix(0.1),
  }),

  signCreate: async () => txSignature("1".repeat(88)),

  register: async () => marketId("fixture-registered-1"),

  now: () => BASE_NOW,
};