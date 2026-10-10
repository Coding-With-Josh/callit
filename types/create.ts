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
  | 'signed'
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
  | { readonly status: 'signed'; readonly draft: ResolvableDraft; readonly imageUrl: string; readonly quote: CreateQuote; readonly build: CreateBuild; readonly signature: TxSignature; readonly signedAt: UnixSeconds }
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
  built: ['signed', 'create_expired', 'failed'],
  signed: ['registered', 'duplicate_market', 'failed'],
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
