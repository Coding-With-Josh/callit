/**
 * panta/create-adapters — the real HTTP implementation of `CreateAdapters`.
 *
 * Owns: turning a validated `ResolvableDraft` into the Panta create wire calls
 * (quote, build, register) and mapping the wire responses back to the domain
 * `CreateQuote` / `CreateBuild` / `MarketId`. Also the image-upload signature
 * request.
 * Must not import: React, Next, or any UI module.
 *
 * NOT exposed to the browser. Only read routes exist under app/api/panta; these
 * write adapters are constructed server-side (after the identity layer can
 * authenticate a caller) and are exercised by tests. This module is the seam the
 * wizard will use once Privy lands — it does not itself open any route.
 *
 * Phase 3 (wallet substitution): `wallet` is bound when the adapter is
 * constructed and is never read from a draft, route param, or client payload.
 * The fee payer therefore cannot be redirected by whoever submits a draft.
 *
 * Money rule: `paymentUsdc` (from the quote) is the ONLY fee authority. build
 * and register never re-derive a fee; they trust the reserved session.
 */
import {
  categoriesResponseSchema,
  createBuildRequestSchema,
  createBuildResponseSchema,
  createIdSchema,
  createQuoteRequestSchema,
  createQuoteResponseSchema,
  eventPdaSchema,
  imageUploadResponseSchema,
  marketIdSchema,
  registerRequestSchema,
  registerResponseSchema,
  unsignedTransactionB64Schema,
  unixSeconds,
  type CreateBuild,
  type CreateQuote,
  type DataProvenance,
  type ImageUploadResponse,
  type LlmDraft,
  type MarketId,
  type ResolvableDraft,
  type Result,
  type TxSignature,
  type UnixSeconds,
} from '@/types';
import type { CreateAdapters, SourceVerification } from '@/lib/create-market';
import { createSourceVerifier } from './source-verifier';
import {
  PantaCallError,
  wireBaseUnitsToUsdc,
  wireIsoToUnixSeconds,
  type PantaClient,
  type PantaTransportError,
} from './client';

/** Everything the real create adapters need that is NOT a Panta call. */
export interface PantaCreateAdapterConfig {
  readonly client: PantaClient;
  /** Fee payer + signer (base58). Bound at session start; never from input. */
  readonly wallet: string;
  /** LLM draft generation (its own server route). Output is untrusted. */
  readonly generateDraft: (claim: string) => Promise<LlmDraft>;
  /** Templated cover -> public http(s) URL (Cloudinary handshake; see P5b). */
  readonly uploadImage: (draft: LlmDraft) => Promise<string>;
  /** Wallet signing hook. Returns the transaction signature. */
  readonly signCreate: (build: CreateBuild) => Promise<TxSignature>;
  /**
   * Source-of-truth verifier. Defaults to the SSRF-hardened reachability
   * check (see source-verifier.ts). Injectable so callers can cap policy or
   * run offline in tests.
   */
  readonly verifySource?: (url: string) => Promise<SourceVerification>;
  /** Clock — injectable for deterministic tests. Defaults to the wall clock. */
  readonly now?: () => UnixSeconds;
}

function defaultNow(): UnixSeconds {
  return unixSeconds(Math.floor(Date.now() / 1000));
}

/**
 * Run a wire->domain mapping, turning any throw (a bad PDA, a non-base64 tx, a
 * value the domain brand rejects) into a typed `PantaCallError`. This keeps the
 * adapter's contract uniform: every failure the pipeline's `try/catch` sees is a
 * PantaCallError, never a raw ZodError.
 */
function mapOrThrow<T>(map: () => T): T {
  try {
    return map();
  } catch {
    throw new PantaCallError({
      kind: 'malformed',
      message: 'Panta response could not be mapped to the domain',
    });
  }
}

/** Wire create quote -> domain quote (the transport-boundary conversions). */
function toDomainQuote(
  wire: ReturnType<typeof createQuoteResponseSchema.parse>,
): CreateQuote {
  return {
    createId: createIdSchema.parse(wire.createId),
    expectedEventPda: eventPdaSchema.parse(wire.expectedEventPda),
    // Fee fields are USDC BASE UNITS as integer strings; convert exactly here.
    paymentUsdc: wireBaseUnitsToUsdc(wire.paymentUsdc),
    liquidityInjectionUsdc: wireBaseUnitsToUsdc(wire.liquidityInjectionUsdc),
    platformRevenueUsdc: wireBaseUnitsToUsdc(wire.platformRevenueUsdc),
    expiresAt: wireIsoToUnixSeconds(wire.expiresAt),
  };
}

/**
 * Request a scoped Cloudinary upload signature. The image bytes never pass
 * through Panta and (P5b) never through this call — the caller posts them
 * directly to Cloudinary, which is why the actual upload lives behind the
 * injected `uploadImage`.
 */
export async function requestImageUploadSignature(
  client: PantaClient,
): Promise<Result<ImageUploadResponse, PantaTransportError>> {
  return client.request({
    method: 'POST',
    path: '/markets/create/image-upload/',
    body: {},
    schema: imageUploadResponseSchema,
  });
}

/** Build the real HTTP-backed create adapters. */
export function createPantaCreateAdapters(
  config: PantaCreateAdapterConfig,
): CreateAdapters {
  const now = config.now ?? defaultNow;
  const provenance: DataProvenance = 'live';

  return {
    provenance,
    generateDraft: config.generateDraft,
    uploadImage: config.uploadImage,
    signCreate: config.signCreate,
    verifySource: config.verifySource ?? createSourceVerifier(),
    now,

    async fetchCategories(): Promise<readonly string[]> {
      const result = await config.client.request({
        method: 'GET',
        path: '/categories/',
        schema: categoriesResponseSchema,
      });
      if (!result.ok) throw new PantaCallError(result.error);
      return result.value.categories;
    },

    async requestQuote(
      draft: ResolvableDraft,
      imageUrl: string,
    ): Promise<CreateQuote> {
      // Allow-list the outgoing body: only these fields reach the wire.
      const body = createQuoteRequestSchema.parse({
        wallet: config.wallet,
        question: draft.question,
        resolutionRule: draft.resolutionRule,
        sourcesOfTruth: draft.sourcesOfTruth,
        category: draft.category,
        startTime: draft.startTime,
        endTime: draft.endTime,
        resolutionTime: draft.resolutionTime,
        imageUrl,
        marketType: draft.marketType,
        eventInProgress: draft.eventInProgress,
        title: draft.title,
        description: draft.description,
        region: draft.region,
      });
      const result = await config.client.request({
        method: 'POST',
        path: '/markets/create/quote/',
        body,
        schema: createQuoteResponseSchema,
      });
      if (!result.ok) throw new PantaCallError(result.error);
      return mapOrThrow(() => toDomainQuote(result.value));
    },

    async buildCreate(quote: CreateQuote): Promise<CreateBuild> {
      const body = createBuildRequestSchema.parse({
        createId: quote.createId,
        wallet: config.wallet,
      });
      const result = await config.client.request({
        method: 'POST',
        path: '/markets/create/build/',
        body,
        schema: createBuildResponseSchema,
      });
      if (!result.ok) throw new PantaCallError(result.error);
      if (result.value.transaction.trim().length === 0) {
        // Phase 2 (fail closed): an empty transaction is not signable, so it
        // must never reach a wallet. (The pk_test sandbox returns "" here.)
        throw new PantaCallError({
          kind: 'malformed',
          message: 'Panta returned no create transaction to sign',
        });
      }
      return mapOrThrow(() => ({
        transaction: unsignedTransactionB64Schema.parse(result.value.transaction),
        recentBlockhash: result.value.recentBlockhash,
        lastValidBlockHeight: result.value.lastValidBlockHeight,
        buildExpiresAt: wireIsoToUnixSeconds(result.value.expiresAt),
      }));
    },

    async register(
      quote: CreateQuote,
      signature: TxSignature,
    ): Promise<MarketId> {
      const body = registerRequestSchema.parse({
        createId: quote.createId,
        signature,
      });
      const result = await config.client.request({
        method: 'POST',
        path: '/markets/register/',
        body,
        schema: registerResponseSchema,
      });
      if (!result.ok) throw new PantaCallError(result.error);
      return mapOrThrow(() => marketIdSchema.parse(result.value.marketId));
    },
  };
}
