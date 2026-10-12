/**
 * blink/params — the closed allowlist of Blink buy parameters.
 *
 * Owns: the preset USDC amounts a Blink button may offer, and the pure parser
 * that turns the action URL's query string into a typed order intent.
 * Must not import: React, Next, adapters, or any framework module.
 *
 * Phase 1/3 (amount + side injection): a Blink POST is unauthenticated and
 * cross-origin. The client must never be able to *contest* the price by posting
 * its own `amountUsdc`/`side`. So both operands come from the server-baked
 * action href, and the parse below is a CLOSED allowlist: anything that is not a
 * literal preset amount is refused before a quote is ever requested. The POST
 * body contributes only `account` (see app/blink/[marketId]/route.ts).
 *
 * Phase 3 (DoS): an allowlist also bounds the request space — there is no
 * "amount 1 wei" path to hammer Panta's shared quote/build budget with.
 */
import {
  err,
  ok,
  usdcDecimalSchema,
  type Result,
  type Side,
  type UsdcDecimal,
} from '@/types';

/**
 * The amounts a Blink button may back, in whole USDC. Deliberately tiny and
 * fixed: every value here must be a `usdcDecimalSchema`-valid string, and the
 * set is the only thing the metadata builder and the parser both read, so the
 * buttons a client renders and the amounts the server accepts cannot drift.
 */
export const BLINK_AMOUNTS_USDC = ['5', '25'] as const;
export type BlinkAmountUsdc = (typeof BLINK_AMOUNTS_USDC)[number];

/** The sides a Blink button may back (mirrors the domain `Side`). */
export const BLINK_SIDES = ['yes', 'no'] as const satisfies readonly Side[];

/** A validated buy intent, read entirely from the server-baked action href. */
export interface BlinkOrderParams {
  readonly side: Side;
  readonly amountUsdc: UsdcDecimal;
  /** The human label for the amount ("5"), for copy that must not re-format money. */
  readonly amountLabel: BlinkAmountUsdc;
}

/** Why a Blink order's query parameters were rejected. */
export type BlinkParamError =
  | 'missing side'
  | 'invalid side'
  | 'missing amount'
  | 'unsupported amount';

/** The exact query parameter names the metadata builder writes and this reads. */
export const SIDE_PARAM = 'side';
export const AMOUNT_PARAM = 'amount';

/**
 * Read the order intent from an action URL's query string.
 *
 * Pure and total: every failure is a typed value, never a throw. `side` is a
 * two-value enum; `amount` is matched against `BLINK_AMOUNTS_USDC` with a strict
 * string compare (no numeric coercion, so "05", "5.0", "5e0" and " 5" are all
 * refused rather than silently normalized into a price).
 */
export function parseBlinkOrderParams(
  searchParams: URLSearchParams,
): Result<BlinkOrderParams, BlinkParamError> {
  const rawSide = searchParams.get(SIDE_PARAM);
  if (rawSide === null) return err('missing side');
  if (rawSide !== 'yes' && rawSide !== 'no') return err('invalid side');

  const rawAmount = searchParams.get(AMOUNT_PARAM);
  if (rawAmount === null) return err('missing amount');

  const preset = BLINK_AMOUNTS_USDC.find((amount) => amount === rawAmount);
  if (preset === undefined) return err('unsupported amount');

  return ok({
    side: rawSide,
    // Re-validate through the domain money schema so a future edit to the
    // allowlist cannot introduce a non-USDC string.
    amountUsdc: usdcDecimalSchema.parse(preset),
    amountLabel: preset,
  });
}

/**
 * The action href for one preset button. Built by the server and baked into the
 * GET metadata, so the POST's operands are server-authored (Phase 3: injection).
 * Relative on purpose: the Solana Actions spec resolves a relative href against
 * the action origin, keeping the Blink portable across domains.
 */
export function blinkActionHref(
  marketId: string,
  side: Side,
  amount: BlinkAmountUsdc,
): string {
  return `/blink/${marketId}?${SIDE_PARAM}=${side}&${AMOUNT_PARAM}=${amount}`;
}
