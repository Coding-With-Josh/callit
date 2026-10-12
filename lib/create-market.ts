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
 * this module — the wizard holds what this module returns. The verified-source
 * gate is the same pattern: `requireVerifiedSource` is the only place the
 * wizard's next-stage decisions read verification state; it never computes
 * "verified" itself, and an adapter outage fails the gate (never passes it).
 * Construction-level safety lives in types/; this file adds runtime stage
 * discipline on top.
 */
import {
  beginCreate,
  canCreateTransition,
  checkResolvable,
  createIdSchema,
  err,
  eventPdaSchema,
  isExpired,
  MARKET_CATEGORY_SLUGS,
  marketId,
  ok,
  openCreateQuote,
  parseRawDraft,
  refloorStaleStart,
  standardStartFloor,
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
  | {
      readonly kind: "unverified_source";
      readonly checks: readonly SourceCheck[];
    }
  | {
      /**
       * Phase 3 (gate honesty): the host is public and answered, but the site
       * refused automated clients so the EXACT page was never proven. Distinct
       * from `unverified_source` on purpose — this one is clearable by the
       * user's attestation, and by nothing else.
       */
      readonly kind: "unconfirmed_source";
      readonly checks: readonly SourceCheck[];
    }
  | { readonly kind: "adapter"; readonly message: string };

/**
 * How much a passed check actually proved (Phase 3).
 *   `confirmed`   — a 2xx: the exact page is publicly served.
 *   `unconfirmed` — a public host answered 403/429 (bot management/throttling).
 *                   It exists and is fetchable, but the page itself was never
 *                   read, so this is NEVER presented as "verified".
 */
export type SourceConfidence = "confirmed" | "unconfirmed";

/**
 * Verdict from one source-verification adapter call (I/O, not a stage).
 * `confidence` is only meaningful when `ok`; absent `confidence` on an `ok`
 * verdict means `confirmed` (the preview fixture, and any caller that has no
 * tier to report).
 */
export interface SourceVerification {
  readonly ok: boolean;
  readonly confidence?: SourceConfidence;
  readonly reason?: string;
}

/** A stamped per-source check the wizard renders as Verify/Verified/Failed. */
export interface SourceCheck {
  readonly url: string;
  readonly ok: boolean;
  /** Absent on a failed check — a rejection has nothing to be confident about. */
  readonly confidence?: SourceConfidence;
  readonly reason?: string;
  readonly checkedAt: UnixSeconds;
}

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
  /**
   * Verify a user-supplied source of truth is reachable and public. This is the
   * I/O behind the verified-source gate: no lifecycle stage past the draft is
   * reached without at least one `ok` here. Live implementations run
   * server-side only (SSRF surface — see lib/panta/source-verifier.ts). A
   * throw is a FAILED check, never a pass (Phase 2: dependency failure).
   */
  readonly verifySource: (url: string) => Promise<SourceVerification>;
  /** Create quote. paymentUsdc in the result is the fee authority. */
  readonly requestQuote: (
    draft: ResolvableDraft,
    imageUrl: string,
  ) => Promise<CreateQuote>;
  /** Build the unsigned Panta transaction. Opaque — never modified. */
  readonly buildCreate: (quote: CreateQuote) => Promise<CreateBuild>;
  /** Wallet signing hook. Returns the transaction signature. */
  readonly signCreate: (build: CreateBuild) => Promise<TxSignature>;
  /**
   * Sign AND submit. THE wallet action: the wallet signs Panta's transaction and
   * hands it to the network in one prompt, returning its signature.
   *
   * This exists because a signature that is never submitted is a dead end —
   * Panta's register step needs the transaction visible on-chain, so a
   * sign-only create can never become a market (observed live as
   * `TX_NOT_FOUND`). Kept separate from `signCreate` so the sign-only path
   * remains expressible, but no step may register from it.
   */
  readonly broadcastCreate: (build: CreateBuild) => Promise<TxSignature>;
  /** Register the broadcast create; returns the on-chain market id. */
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
  const now = adapters.now();
  /**
   * Phase 3 (stale-clock / boundary race): the lead rule is measured against a
   * MOVING clock, so a start seeded at *exactly* the floor is valid for one
   * instant and stale the next. The draft generator did precisely that
   * (`now + MIN_STANDARD_LEAD_SECONDS`), so the user generated a draft, spent a
   * second or more on the step, and every standard market failed with
   * "standard markets must start at least 3700s from now" regardless of what
   * they did. Re-floor a start that is on/after today to the FRESH floor
   * (floor + headroom) before validating.
   *
   * Deliberately NOT applied to a start on a PAST day: the validator must still
   * reject that (past-date injection) and a lift would silently rescue it. The
   * lift only ever moves a start LATER, never earlier, and only when it would
   * otherwise be inside the lead.
   */
  let raw = lifecycle.raw;
  const usesBreaking =
    raw.marketType === "breaking" && raw.eventInProgress === true;
  // Untrusted input: prove well-formedness BEFORE handing the start to the
  // shared rule, whose day arithmetic throws on a negative/invalid value.
  const startIsWellFormed =
    Number.isInteger(raw.startTime) && raw.startTime >= 0;
  if (startIsWellFormed) {
    // The rule itself lives in types/time (refloorStaleStart) because `now` is
    // consumed at TWO moments — here, and again when the quote is produced. The
    // quote producer re-applies the SAME rule so a draft that was valid at
    // Continue is still valid upstream minutes later, instead of being refused
    // with "startTime must be at least 3600s ahead of now".
    raw = {
      ...raw,
      startTime: refloorStaleStart(raw.startTime, now, usesBreaking),
    };
  }
  const result = validateDraft(raw, {
    categories,
    now,
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
  // `build_expired` is accepted so a stale payload can be REPLACED (Phase 3:
  // stale-payload replay). Rebuilding is free and changes nothing the user was
  // shown: it reuses the SAME quote, so `paymentUsdc` — the only fee authority —
  // is unchanged and no re-approval is implied.
  if (lifecycle.status !== "quoted" && lifecycle.status !== "build_expired") {
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

/** signed -> registered is no longer legal: a signature alone is not a market.
 *  Kept as a step so the sign-only stage is still expressible and testable. */
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
  // Same freshness guard as `broadcastStep`, for the same reason: a signature
  // over a transaction whose blockhash has expired can never land, so asking the
  // wallet for one is a pointless prompt (Phase 3: stale-payload replay). The
  // invariant is uniform — no wallet prompt over a stale build, on ANY path.
  const signedAt = adapters.now();
  if (isExpired(lifecycle.build.buildExpiresAt, signedAt)) {
    return ok({
      status: "build_expired",
      draft: lifecycle.draft,
      imageUrl: lifecycle.imageUrl,
      quote: lifecycle.quote,
      at: signedAt,
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

/**
 * built -> broadcast (or signed -> broadcast). THE money step: the wallet signs
 * and the network is handed the transaction. From this point the market may
 * already exist and the fee may already have moved, which is why this stage has
 * no path back to `built`/`signed` (Phase 3: a re-sign here would spend twice).
 *
 * The timestamp is taken AFTER the wallet returns, so `broadcastAt` never
 * precedes the send. `signedAt` is the same instant on the sign-and-send path
 * because the wallet performs both in one prompt.
 */
export async function broadcastStep(
  lifecycle: CreateLifecycle,
  adapters: CreateAdapters,
): Promise<Result<CreateLifecycle, CreateMarketError>> {
  const blocked = guardTransition(lifecycle, "broadcast");
  if (blocked) return err(blocked);
  if (lifecycle.status !== "built" && lifecycle.status !== "signed") {
    return err({
      kind: "invalid_transition",
      from: lifecycle.status,
      to: "broadcast",
    });
  }
  // Phase 3 (stale-payload replay) — THE guard. `built` is a state; the
  // transaction inside it is a payload with a ~60s blockhash window
  // (`blockhashExpiryHintSec`, live-verified). "Prepare" and "submit" are two
  // deliberate user actions, so the gap between them is human-paced and
  // routinely exceeds that window. Without this check the wallet is prompted,
  // the bytes are broadcast against a dead blockhash, and the user gets
  // `-32002 Blockhash not found` from their RPC with no way to tell whether the
  // fee moved. Returning here means NO adapter call, so no prompt and no bytes.
  //
  // This is the ONLY spend path in the app, which is why the check belongs here
  // and not only in the UI: any future caller inherits it.
  const checkedAt = adapters.now();
  if (isExpired(lifecycle.build.buildExpiresAt, checkedAt)) {
    return ok({
      status: "build_expired",
      draft: lifecycle.draft,
      imageUrl: lifecycle.imageUrl,
      quote: lifecycle.quote,
      at: checkedAt,
    });
  }
  let signature: TxSignature;
  try {
    signature = await adapters.broadcastCreate(lifecycle.build);
  } catch (error) {
    return err({ kind: "adapter", message: adapterMessage(error) });
  }
  const at = adapters.now();
  return ok({
    status: "broadcast",
    draft: lifecycle.draft,
    imageUrl: lifecycle.imageUrl,
    quote: lifecycle.quote,
    build: lifecycle.build,
    signature,
    signedAt: at,
    broadcastAt: at,
  });
}

/**
 * broadcast -> registered. Returns the on-chain market id.
 *
 * Reached ONLY from `broadcast`: register is a REPORT of a transaction that is
 * already on the network, so this step can neither spend nor create anything —
 * a retry re-sends the same report, and Panta refuses an already-consumed
 * create session rather than creating a second market (Phase 3: duplicate
 * registration is idempotent).
 */
export async function registerStep(
  lifecycle: CreateLifecycle,
  adapters: CreateAdapters,
): Promise<Result<CreateLifecycle, CreateMarketError>> {
  const blocked = guardTransition(lifecycle, "registered");
  if (blocked) return err(blocked);
  if (lifecycle.status !== "broadcast") {
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

// ─── Source-of-truth verification ────────────────────────────────────────────

/**
 * Lift a user's calendar-day choice (midnight UTC, from the date input) to the
 * earliest VALID open time. The lead rule works in seconds but the wizard
 * edits whole days: choosing "today" must not produce a timestamp the
 * validator rejects, and choosing a day that is only seconds away (e.g.
 * tomorrow picked at 23:59 UTC) is clamped to the floor instead of erroring.
 * `minLeadSeconds` is the lead required by this market type (0 for a breaking
 * in-progress market, MIN_STANDARD_LEAD_SECONDS otherwise).
 */
export function effectiveStartSeconds(
  dayStart: number,
  now: UnixSeconds,
  minLeadSeconds: number,
): UnixSeconds {
  return unixSeconds(Math.max(dayStart, now + minLeadSeconds));
}

/** Wrap one adapter verification into a stamped check; adapter failure = unverified. */
export async function checkSource(
  url: string,
  adapters: CreateAdapters,
): Promise<SourceCheck> {
  const trimmed = url.trim();
  try {
    const verified = await adapters.verifySource(trimmed);
    if (!verified.ok) {
      return {
        url: trimmed,
        ok: false,
        reason: verified.reason,
        checkedAt: adapters.now(),
      };
    }
    return {
      url: trimmed,
      ok: true,
      // An adapter that reports no tier is reporting the strong one (the
      // preview fixture does exactly this). Anything that is not explicitly
      // 'unconfirmed' must not be treated as weaker than it is.
      confidence:
        verified.confidence === "unconfirmed" ? "unconfirmed" : "confirmed",
      checkedAt: adapters.now(),
    };
  } catch (error) {
    // Phase 2 (dependency failure): a verification outage is a FAILED check,
    // never an implicit pass. Fail closed.
    return {
      url: trimmed,
      ok: false,
      reason: adapterMessage(error),
      checkedAt: adapters.now(),
    };
  }
}

/**
 * Phase 3 (source-of-truth gate): no lifecycle stage past the draft may be
 * reached without a usable public source of truth. The domain (checkResolvable)
 * proves the source is a syntactically public http(s) URL; this adds the
 * reachability proof on top. Returns the per-source checks for the wizard's
 * chips on success, or a `*_source` error on failure.
 *
 * Three outcomes, in strict order of strength:
 *   1. any `confirmed` check       -> ok, no attestation needed.
 *   2. only `unconfirmed` checks   -> ok ONLY when `attestUnconfirmed === true`.
 *      The caller is asserting a fact it cannot verify, which is why the exact
 *      `true` comparison is used: a truthy-but-not-true value (a string, a 1)
 *      must not open the gate.
 *   3. nothing usable              -> `unverified_source`.
 *
 * Attestation can never rescue a check that outright failed — reachable in any
 * stage's gate, and the direction that must stay impossible.
 */
export async function requireVerifiedSource(
  sources: readonly string[],
  adapters: CreateAdapters,
  options: { readonly attestUnconfirmed?: boolean } = {},
): Promise<Result<readonly SourceCheck[], CreateMarketError>> {
  const nonEmpty = sources.map((source) => source.trim()).filter((s) => s.length > 0);
  if (nonEmpty.length === 0) {
    return err({ kind: "unverified_source", checks: [] });
  }
  const checks: SourceCheck[] = [];
  for (const source of nonEmpty) {
    checks.push(await checkSource(source, adapters));
  }
  if (checks.some((check) => check.ok && check.confidence === "confirmed")) {
    return ok(checks);
  }
  if (checks.some((check) => check.ok)) {
    return options.attestUnconfirmed === true
      ? ok(checks)
      : err({ kind: "unconfirmed_source", checks });
  }
  return err({ kind: "unverified_source", checks });
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
    // Wire categories are lowercase slugs; the stub uses one so a draft is
    // valid against both the live category list and this fallback.
    category: "crypto",
    // Start date defaults to TODAY (the earliest open the standard lead rule
    // allows), anchored to the injectable clock — never a fixed future date,
    // so a market can never open on a previous day. Seeded at the floor PLUS
    // headroom (standardStartFloor), not at the bare floor: a value sitting on
    // the boundary is invalid one second later. The wizard only lets the user
    // move it forward.
    startTime: standardStartFloor(BASE_NOW),
    endTime: BASE_NOW + 30 * DAY,
    resolutionTime: BASE_NOW + 31 * DAY,
    imageUrl: "https://fixture.example.com/cover.png",
    marketType: "standard",
    eventInProgress: false,
  }),

  // The domain's closed category allowlist — used only when the live category
  // read is unavailable. Same slug space the wire contract accepts.
  fetchCategories: async () => [...MARKET_CATEGORY_SLUGS],

  // Stub upload: returns a placeholder public URL. The real flow uploads the
  // templated bytes and returns the storage URL (UNVERIFIED handshake).
  uploadImage: async () => "https://fixture.example.com/cover.png",

  // Preview approximation of the server-side reachability check — NO network
  // in the wizard. Mirrors the live verifier's rules (scheme allow-list, no
  // localhost, no IP literals) so the preview experience matches production;
  // the live adapter (lib/panta/source-verifier.ts) adds DNS + status checks.
  verifySource: async (url) => {
    const value = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return { ok: false, reason: "not a valid URL" };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "must be a public http(s) URL" };
    }
    const host = parsed.hostname.toLowerCase();
    if (
      !host.includes(".") ||
      host === "localhost" ||
      host.endsWith(".localhost")
    ) {
      return { ok: false, reason: "host does not look like a public site" };
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return { ok: false, reason: "IP-address sources are not allowed" };
    }
    return { ok: true, confidence: "confirmed" };
  },

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

  // Same signature as `signCreate` on purpose: an ed25519 signature is
  // deterministic over the same bytes, so signing and sign-and-send cannot
  // produce different signatures for the same transaction.
  broadcastCreate: async () => txSignature("1".repeat(88)),

  register: async () => marketId("fixture-registered-1"),

  now: () => BASE_NOW,
};