/**
 * buy/price-check — "can Panta price this market right now?" as a gate decision.
 *
 * Owns: the response -> probe -> status mapping, and the bounded re-check that
 * rides out a short unpriced window. Pure and React-free (it takes a probe
 * function and a response shape, not a fetch), so both the decision and the
 * retry policy are unit-tested without a browser or a network.
 *
 * Why this exists (Phase 3, measured live 2026-10-13): Panta serves the market
 * read in two variants per request, and in the lean one every price is null.
 * While a market is in that state `/primaryorderquote/` answers a bare
 * `{"code":"INVALID_MARKET_PARAMS"}` — so a buy slip that invites an amount
 * during an unpriced window collects an order that cannot be quoted. The window
 * is per-market and lasts seconds to tens of seconds (one market's `/prices/`
 * path read 200, 200, 404, 404, 200 inside twelve seconds), which is exactly why
 * the re-check below is bounded and flat rather than a long backoff: the state is
 * not congestion to be waited out, it is a window that opens and closes on its
 * own.
 *
 * This is an AFFORDANCE, never the control (Phase 1): the server denies
 * independently — the quote route sits behind the session guard and Panta itself
 * refuses an unpriced market, and that refusal is mapped to honest copy. A gate
 * that a caller could skip is still worth having, because it is the difference
 * between telling a user "we cannot price this market right now" and letting them
 * compose an order that cannot be quoted.
 */
import { z } from 'zod';
import { isPriced, type DataProvenance, type PricedFields } from '@/types';
import { priceSchema } from '@/types/money';

/**
 * The slice of `GET /api/panta/markets/{id}` this gate consumes, validated
 * explicitly (Phase 4: consume only what was checked, never a cast). Everything
 * else in that payload is the detail page's business, and `null` here means
 * "the market could not be read", which is deliberately NOT treated as absent.
 */
export const marketPriceProbeSchema = z.object({
  market: z
    .object({
      yesPrice: priceSchema.nullable(),
      noPrice: priceSchema.nullable(),
    })
    .nullable(),
});

/** The minimum shape of an `authedJson` result this module needs. */
export type ProbeResponse =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly status: number };

/**
 * What one read of the market told us.
 *
 * `failed` and `absent` are kept apart from `unpriced` because they are different
 * facts with different remedies: `failed` means we could not establish anything
 * (a 5xx, an expired session, an offline client, a payload we could not read) and
 * retrying immediately is guesswork, while `absent` means Panta does not serve
 * this market at all — no number of re-checks prices it.
 */
export type PriceProbe =
  | { readonly kind: 'market'; readonly market: PricedFields }
  | { readonly kind: 'absent' }
  | { readonly kind: 'failed' };

/**
 * The gate's verdict for one probe.
 *
 * `unpriced` is the only RETRYABLE state (a window may open). `unknown` fails
 * closed for display — the slip is withheld — but is not re-checked inside this
 * call, because a failing read is not evidence that waiting helps.
 */
export type PriceStatus = 'priced' | 'unpriced' | 'unknown';

/** Map one probe to a verdict. Absent and failed both deny; only one re-checks. */
export function statusOfProbe(probe: PriceProbe): PriceStatus {
  if (probe.kind === 'failed') return 'unknown';
  // No such market: there is nothing to price and nothing to buy, so this denies
  // like an unpriced window even though re-checking will not change it.
  if (probe.kind === 'absent') return 'unpriced';
  return isPriced(probe.market) ? 'priced' : 'unpriced';
}

/**
 * Turn an HTTP result into a probe.
 *
 * Fail closed at every branch: a 404 is `absent` (the route answers 404 for both
 * a rejected id charset and a market Panta does not know — neither is quotable),
 * any other failure is `failed`, and a 2xx body that does not match the schema is
 * `failed` rather than silently read as "no market".
 */
export function probeOfResponse(response: ProbeResponse): PriceProbe {
  if (!response.ok) {
    return response.status === 404 ? { kind: 'absent' } : { kind: 'failed' };
  }
  const parsed = marketPriceProbeSchema.safeParse(response.data);
  if (!parsed.success) return { kind: 'failed' };
  if (parsed.data.market === null) return { kind: 'absent' };
  return { kind: 'market', market: parsed.data.market };
}

/** Attempts, and the flat delay between them. */
export const PRICE_CHECK_ATTEMPTS = 3;
export const PRICE_CHECK_DELAY_MS = 900;

export interface CheckPriceOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Probe until the market is priced, we could not tell, or the attempts run out.
 *
 * Bounded and flat-delayed on purpose: no backoff (this is not congestion), and a
 * hard attempt cap so a market that is unpriced for a long stretch cannot hold
 * the caller in a loop. `unknown` returns immediately — a failing read is not
 * evidence that waiting helps, and the user's "Check again" is the right remedy.
 */
export async function checkPrice(
  probe: () => Promise<PriceProbe>,
  options: CheckPriceOptions = {},
): Promise<PriceStatus> {
  const attempts = Math.max(1, options.attempts ?? PRICE_CHECK_ATTEMPTS);
  const delayMs = Math.max(0, options.delayMs ?? PRICE_CHECK_DELAY_MS);
  let status: PriceStatus = 'unknown';
  for (let attempt = 1; attempt <= attempts; attempt++) {
    status = statusOfProbe(await probe());
    if (status !== 'unpriced') return status;
    if (attempt < attempts && delayMs > 0) await sleep(delayMs);
  }
  return status;
}

/**
 * The gate's displayed state.
 *
 * `preview` is a state of its own rather than a flavour of `unknown`: a fixture
 * market is not a market whose price we failed to read, it is not a live market at
 * all, so re-checking it is meaningless and the copy must say so. It is also the
 * one state in which the gate never touches the network.
 *
 * `inactive` exists to keep `checking` honest: an unauthenticated visitor cannot
 * buy, so there is nothing to gate — and a gate stuck on `checking` would spin
 * forever and mislabel the slip. It is NOT a denial (the connect affordance is the
 * right thing to show) and it is NOT a claim of priceability either; it means
 * "this gate is not the thing standing between you and a purchase right now".
 */
export type PriceGateState =
  | PriceStatus
  | 'checking'
  | 'preview'
  | 'inactive';

/** What a completed check concluded, and which inputs it belongs to. */
export interface PriceGateResult {
  readonly key: string;
  readonly status: PriceStatus;
}

/**
 * The identity of the inputs a conclusion was reached from. A result whose key
 * does not match the current inputs is not this market's answer and is never
 * displayed.
 */
export const priceGateKey = (
  marketId: string,
  provenance: DataProvenance,
  active: boolean,
): string => `${marketId}\u0000${provenance}\u0000${active ? '1' : '0'}`;

/**
 * Derive the displayed state instead of storing it.
 *
 * Deriving is what makes two safety properties structural rather than remembered:
 * `checking` is simply "no conclusion exists for these inputs" (so no effect has to
 * set it, and there is no render that shows a stale verdict while a new one is in
 * flight), and a verdict from a previous market, provenance, or session can never
 * be shown as the current one — the key comparison is the closing construct. The
 * one verdict that must never be stale is `priced`: it is what puts the buy
 * controls on screen.
 */
export function derivePriceGateState(inputs: {
  readonly provenance: DataProvenance;
  readonly active: boolean;
  readonly key: string;
  readonly result: PriceGateResult | null;
}): PriceGateState {
  if (inputs.provenance !== 'live') return 'preview';
  if (!inputs.active) return 'inactive';
  if (inputs.result !== null && inputs.result.key === inputs.key) {
    return inputs.result.status;
  }
  return 'checking';
}
