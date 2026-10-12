/**
 * create — the market-creation lifecycle state machine.
 *
 * Owns: CreateQuote, CreateBuild, the CreateLifecycle discriminated union, its
 * legal transitions, and the guarded entry point.
 * Must not import: adapters, network, or any framework.
 *
 * Enforced ordering: the Panta-facing entry point accepts only a ResolvableDraft,
 * so a draft can reach the create flow only through `validateDraft` then
 * `checkResolvable`. CREATE_EXPIRED and DUPLICATE_MARKET are explicit branches.
 */
import type { CreateId, EventPda, MarketId, TxSignature } from './ids';
import type { UsdcDecimal } from './money';
import type { UnixSeconds } from './time';
import type { UnsignedTransactionB64 } from './tx';
import type { PantaError } from './errors';
import type { RawDraft, ResolvableDraft, ValidatedDraft } from './draft';

/** A create quote: the only authority on the creation fee. */
export interface CreateQuote {
  readonly createId: CreateId;
  readonly expectedEventPda: EventPda;
  readonly paymentUsdc: UsdcDecimal;
  readonly liquidityInjectionUsdc: UsdcDecimal;
  readonly platformRevenueUsdc: UsdcDecimal;
  readonly expiresAt: UnixSeconds;
}

/** A built create transaction (base64 versioned tx) and its blockhash window. */
export interface CreateBuild {
  readonly transaction: UnsignedTransactionB64;
  readonly recentBlockhash: string;
  readonly lastValidBlockHeight: number;
  readonly buildExpiresAt: UnixSeconds;
}

/** Every stage a create can be in. */
export type CreateStage =
  | 'drafted'
  | 'validated'
  | 'resolvable'
  | 'imaged'
  | 'quoted'
  | 'built'
  /**
   * A built transaction whose blockhash window has passed. NOT a failure: the
   * build is a disposable payload, and the only honest thing to do with a stale
   * one is to replace it. It is a stage (rather than an error) so that the
   * machine can express "the payload died, the create session did not" — which
   * is what lets the send step refuse to prompt the wallet and then recover
   * legally.
   */
  | 'build_expired'
  | 'signed'
  | 'broadcast'
  | 'registered'
  | 'create_expired'
  | 'duplicate_market'
  | 'failed';

/** The create lifecycle union. */
export type CreateLifecycle =
  | { readonly status: 'drafted'; readonly raw: RawDraft }
  | { readonly status: 'validated'; readonly draft: ValidatedDraft }
  | { readonly status: 'resolvable'; readonly draft: ResolvableDraft }
  | { readonly status: 'imaged'; readonly draft: ResolvableDraft; readonly imageUrl: string }
  | { readonly status: 'quoted'; readonly draft: ResolvableDraft; readonly imageUrl: string; readonly quote: CreateQuote }
  | { readonly status: 'built'; readonly draft: ResolvableDraft; readonly imageUrl: string; readonly quote: CreateQuote; readonly build: CreateBuild }
  | { readonly status: 'build_expired'; readonly draft: ResolvableDraft; readonly imageUrl: string; readonly quote: CreateQuote; readonly at: UnixSeconds }
  | { readonly status: 'signed'; readonly draft: ResolvableDraft; readonly imageUrl: string; readonly quote: CreateQuote; readonly build: CreateBuild; readonly signature: TxSignature; readonly signedAt: UnixSeconds }
  | { readonly status: 'broadcast'; readonly draft: ResolvableDraft; readonly imageUrl: string; readonly quote: CreateQuote; readonly build: CreateBuild; readonly signature: TxSignature; readonly signedAt: UnixSeconds; readonly broadcastAt: UnixSeconds }
  | { readonly status: 'registered'; readonly draft: ResolvableDraft; readonly quote: CreateQuote; readonly marketId: MarketId; readonly registeredAt: UnixSeconds }
  | { readonly status: 'create_expired'; readonly at: UnixSeconds }
  | { readonly status: 'duplicate_market'; readonly question: string; readonly at: UnixSeconds }
  | { readonly status: 'failed'; readonly error: PantaError; readonly at: UnixSeconds };

/** Legal transitions for a create. */
export const CREATE_TRANSITIONS: Readonly<Record<CreateStage, readonly CreateStage[]>> = {
  drafted: ['validated', 'failed'],
  validated: ['resolvable', 'failed'],
  resolvable: ['imaged', 'quoted', 'create_expired', 'failed'],
  imaged: ['quoted', 'create_expired', 'failed'],
  quoted: ['built', 'create_expired', 'duplicate_market', 'failed'],
  // `built` carries a DISPOSABLE payload with a ~60s blockhash window. It may
  // move to `build_expired` (the window closed) and, from there, only back to
  // `built` with a REPLACEMENT build. There is still no edge from `broadcast` or
  // `signed` back to here: re-signing an already-submitted transaction is how a
  // user gets charged twice (Phase 3: double spend by re-sign), and the refresh
  // edge below is only open BEFORE anything has been submitted.
  built: ['broadcast', 'signed', 'build_expired', 'create_expired', 'failed'],
  build_expired: ['built', 'create_expired', 'failed'],
  // `signed` is the sign-ONLY path: held for the transport that signs without
  // sending. A signature alone is never sufficient to register, so the only way
  // on from here is to actually put the transaction on-chain.
  //
  // `build_expired` is reachable from here because the signature is over a
  // specific set of bytes: if that build's blockhash window has closed, the
  // signature is worthless AND nothing was ever submitted, so the only honest
  // move is to drop it and replace the payload. `broadcastStep` therefore
  // refuses from `signed` too, and the table must permit the state it returns.
  // This is NOT a path back to re-signing something already sent: `broadcast`
  // and `registered` still have no edge here.
  signed: ['broadcast', 'build_expired', 'duplicate_market', 'failed'],
  // `broadcast` is the state that MATTERS for honesty: the transaction is (or is
  // being handed to) the network, so the market may already exist and the fee
  // may already have moved. There is deliberately NO edge back to `built` or
  // `signed` — re-signing from here is how a user would be charged twice (Phase 3:
  // double spend by re-sign). Registering is a REPORT of an already-submitted
  // transaction, so it is the only forward step and it is safe to retry.
  broadcast: ['registered', 'failed'],
  registered: [],
  create_expired: ['resolvable'],
  duplicate_market: ['resolvable'],
  failed: ['resolvable'],
};

/** True when `to` is a legal next stage from `from`. */
export function canCreateTransition(from: CreateStage, to: CreateStage): boolean {
  return CREATE_TRANSITIONS[from].includes(to);
}

/** Begin tracking a raw draft (bookkeeping only; not yet validatable). */
export function beginCreate(raw: RawDraft): CreateLifecycle {
  return { status: 'drafted', raw };
}

/**
 * Open a create quote. Accepts only a ResolvableDraft — the type-level proof
 * that the draft passed both validators.
 */
export function openCreateQuote(
  draft: ResolvableDraft,
  imageUrl: string,
  quote: CreateQuote,
): CreateLifecycle {
  return { status: 'quoted', draft, imageUrl, quote };
}
