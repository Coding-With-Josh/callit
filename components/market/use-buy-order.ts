'use client';

/**
 * use-buy-order — the client orchestration for a primary buy.
 *
 * Owns: the two-step flow (prepare: quote -> build -> verify -> assemble, then
 * confirm: wallet sign AND send, then report to Panta), the session-mint retry on
 * a 401, and the user-facing status copy. Must not construct a transaction
 * itself — every gate lives in lib/buy/client and lib/solana/assemble.
 *
 * Phase 1 (complete mediation): the hooks here call only the app's own routes
 * (`/api/panta/buy/quote`, `/api/panta/buy/build`, `/api/panta/buy/submit`).
 * Those routes re-authenticate the session and re-derive the wallet
 * server-side; nothing in this hook can redirect the fee payer, and the
 * client-side `wallet` used for verification is the session identity wallet from
 * Privy, not a caller-supplied string.
 *
 * Phase 2 (no internals leak): an upstream failure returns only a status here;
 * the response body is never read, stored, or rendered. Every message the hook
 * exposes is fixed copy from this module.
 *
 * Phase 3 (fee disclosure before signing): prepare and confirm are deliberately
 * separate. The quote's real fee is on screen (status `ready`) before the wallet
 * is ever prompted — a single-click flow could not guarantee that.
 * Phase 3 (stale order): the assembled transaction carries Panta's blockhash
 * lifetime; confirm re-checks `buildExpiresAt` before prompting the wallet, so a
 * user who lingered on the review step cannot sign an expired order.
 *
 * The wallet SIGNS AND SENDS in one prompt (the shared capability in
 * use-solana-signer). Panta does not broadcast for us: it needs the transaction
 * on-chain before it will record the order, which is why the status stops at
 * `broadcast` — on-chain, possibly already filled — BEFORE anything is claimed
 * about the outcome, and why no status after that point offers a re-sign.
 */
import { useCallback, useState } from 'react';
import { useSolanaSigner } from '@/components/auth/use-solana-signer';
import type { SignRequestError } from '@/components/auth/use-solana-signer';
import { authedJson } from '@/components/auth/authed-json';
import {
  marketIdSchema,
  unixSeconds,
  usdcDecimalSchema,
  type BuiltOrder,
  type BuyQuote,
  type MarketId,
  type PantaTransaction,
  type Side,
  type UsdcDecimal,
} from '@/types';
import {
  assembleBuyOrder,
  describeBuyReportError,
  parseBuiltOrder,
  parseBuyQuote,
  verifyBuyOrder,
} from '@/lib/buy/client';
import { describeSignRequestError } from '@/lib/solana/sign-messages';
import { describeAuthedFailure } from '@/lib/auth/session-mint';

export type BuyOrderStatus =
  | 'idle'
  | 'quoting'
  | 'building'
  | 'ready'
  | 'signing'
  /**
   * A send failed in a way that cannot be told apart from "it may have landed".
   * Deliberately NOT `ready`: offering an immediate re-sign from here is how a
   * second order gets placed on top of one that already filled.
   */
  | 'unconfirmed'
  /** Submitted on-chain; the report to Panta is in flight. */
  | 'broadcast'
  /** Submitted AND recorded by Panta. Terminal for this order. */
  | 'submitted'
  /** Submitted on-chain, but Panta has not recorded it. Reportable again. */
  | 'reportFailed'
  /**
   * Submitted on-chain, but Panta REFUSED to record it and retrying cannot
   * change that (a stale quote — `QUOTE_EXPIRED`). Terminal: no retry offered,
   * because the order may already have moved money and the copy has to send the
   * user to their positions instead of to a button that will fail again.
   */
  | 'reportRefused';

/** The operands the user asked to buy, once each has passed its schema. */
interface PreparedRequest {
  readonly marketId: MarketId;
  readonly side: Side;
  readonly amountUsdc: UsdcDecimal;
}

/** Fixed user copy keyed by the route's HTTP status. Never the response body. */
function requestErrorMessage(status: number): string {
  if (status === 401 || status === 403) return 'Sign in to continue.';
  if (status === 400) return "That order isn't valid. Check the amount and try again.";
  if (status === 404) return 'That market is no longer available to buy.';
  if (status === 429) return 'Too many requests — wait a moment and try again.';
  // 502 is this app's wrapper around an upstream Panta failure (including
  // Panta rejecting our credentials — never the caller's session).
  if (status === 502) return 'Trading is temporarily unavailable.';
  if (status === 503) return 'Trading is temporarily unavailable.';
  if (status === 504) return "Panta didn't respond in time.";
  return 'The order could not be prepared.';
}

export interface BuyOrderController {
  readonly status: BuyOrderStatus;
  readonly error: string | null;
  readonly quote: BuyQuote | null;
  readonly signature: string | null;
  /** Quote -> build -> verify -> assemble. Populates `quote` and stops. */
  readonly prepare: (marketId: string, side: Side, amount: string) => Promise<void>;
  /**
   * Sign AND submit the prepared order. Refuses an expired or absent order (fail
   * closed). This is the spending action: it opens the wallet, which submits the
   * transaction, and then reports the result to Panta.
   */
  readonly confirm: () => Promise<void>;
  /**
   * Re-report an order that was submitted but not recorded. Sends the SAME
   * orderId + signature, so it can neither place a second order nor spend again.
   */
  readonly report: () => Promise<void>;
  readonly reset: () => void;
}

export function useBuyOrder(): BuyOrderController {
  const { wallet, signAndSend } = useSolanaSigner();
  const [status, setStatus] = useState<BuyOrderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<BuyQuote | null>(null);
  const [order, setOrder] = useState<BuiltOrder | null>(null);
  const [transaction, setTransaction] = useState<PantaTransaction | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
    setQuote(null);
    setOrder(null);
    setTransaction(null);
    setSignature(null);
  }, []);

  const prepare = useCallback(
    async (marketIdRaw: string, side: Side, amountRaw: string) => {
      setError(null);
      setSignature(null);
      setQuote(null);
      setOrder(null);
      setTransaction(null);

      // Perimeter validation (Phase 4): all three operands are user input.
      const marketId = marketIdSchema.safeParse(marketIdRaw);
      const amount = usdcDecimalSchema.safeParse(amountRaw);
      if (!marketId.success || !amount.success) {
        setStatus('idle');
        setError('Enter a USDC amount like 25 or 25.50.');
        return;
      }
      if (amount.data === '0') {
        setStatus('idle');
        setError('Enter an amount greater than zero.');
        return;
      }
      // Fail closed without a session wallet: we cannot verify the order echo,
      // and the signer would refuse anyway.
      if (!wallet) {
        setStatus('idle');
        setError('Sign in to buy.');
        return;
      }
      const request: PreparedRequest = {
        marketId: marketId.data,
        side,
        amountUsdc: amount.data,
      };

      setStatus('quoting');
      const quoteRes = await authedJson('/api/panta/buy/quote', {
        method: 'POST',
        body: {
          marketId: request.marketId,
          side: request.side,
          amountUsdc: request.amountUsdc,
        },
      });
      if (!quoteRes.ok) {
        setStatus('idle');
        // A session failure names itself; only a non-auth failure falls back to
        // the status copy. "Sign in to continue." for a mint failure is the
        // false statement this avoids.
        setError(
          describeAuthedFailure(
            quoteRes.status,
            quoteRes.sessionFailure,
            requestErrorMessage,
          ),
        );
        return;
      }
      const parsedQuote = parseBuyQuote(quoteRes.data);
      if (!parsedQuote.ok) {
        setStatus('idle');
        setError('Panta returned a quote we could not read.');
        return;
      }
      setQuote(parsedQuote.value);

      setStatus('building');
      const buildRes = await authedJson('/api/panta/buy/build', {
        method: 'POST',
        body: { quoteId: parsedQuote.value.quoteId },
      });
      if (!buildRes.ok) {
        setStatus('idle');
        setError(
          describeAuthedFailure(
            buildRes.status,
            buildRes.sessionFailure,
            requestErrorMessage,
          ),
        );
        return;
      }
      const parsedOrder = parseBuiltOrder(buildRes.data);
      if (!parsedOrder.ok) {
        setStatus('idle');
        setError('Panta returned an order we could not read.');
        return;
      }

      // Phase 3 (parameter substitution): the order's echo must answer exactly
      // the request the user made, to exactly their wallet.
      const verified = verifyBuyOrder(parsedQuote.value, parsedOrder.value, {
        marketId: request.marketId,
        side: request.side,
        amountUsdc: request.amountUsdc,
        wallet,
      });
      if (!verified.ok) {
        setStatus('idle');
        setError('Refusing: the order does not match what you asked for.');
        return;
      }

      // Compile through the single-signer / TOCTOU gates.
      const assembled = assembleBuyOrder(verified.value, wallet);
      if (!assembled.ok) {
        setStatus('idle');
        setError('The order could not be prepared for signing.');
        return;
      }

      setOrder(verified.value);
      setTransaction(assembled.value);
      setStatus('ready');
    },
    [wallet],
  );

  const confirm = useCallback(async () => {
    if (!order || !transaction) {
      setStatus('idle');
      setError('Prepare the order again before signing.');
      return;
    }
    // Phase 3 (stale order): the blockhash lifetime from Panta bounds when these
    // bytes are valid. Re-check before the wallet prompt; fail closed if passed.
    const nowSeconds = unixSeconds(Math.floor(Date.now() / 1000));
    if (nowSeconds >= order.buildExpiresAt) {
      setStatus('idle');
      setOrder(null);
      setTransaction(null);
      setError('This order expired. Review it again to get a fresh one.');
      return;
    }

    setError(null);
    setStatus('signing');
    // Sign AND send in one wallet prompt. The single-signer / session-wallet /
    // decode gates run inside the signer BEFORE the wallet sees the bytes.
    const sent = await signAndSend(transaction);
    if (!sent.ok) {
      if (sent.error.kind === 'send-failed') {
        // Phase 3 (ambiguous send): the order may already be on-chain. Landing
        // on `ready` would offer a re-sign and risk a second order, so this is
        // its own state and the copy sends the user to their positions.
        setStatus('unconfirmed');
        setError(describeSignRequestError(sent.error));
        return;
      }
      // Every other kind is refused BEFORE the prompt (no wallet, gate refusal,
      // or the user rejecting it), so nothing was submitted and `ready` is an
      // honest place to retry from.
      setStatus('ready');
      setError(signErrorMessage(sent.error));
      return;
    }
    setSignature(sent.value.signature);
    // `broadcast` BEFORE the report: the transaction is already on-chain, so the
    // order may exist and the funds may have moved from this moment on.
    setStatus('broadcast');

    // Report it to Panta. Panta does not broadcast for us — it records what it
    // can see on-chain — so an unreported order is one Panta never indexes.
    // `reportOrder` retries only the transient "not visible yet" answer.
    const reported = await reportOrder(order.orderId, sent.value.signature);
    if (!reported.ok) {
      // NOT a failure of the order, only of the report. `reportFailed` keeps the
      // signature, offers no re-sign, and can be retried idempotently; 409 is a
      // refusal retrying cannot fix, so it becomes terminal instead.
      setStatus(reported.status === 409 ? 'reportRefused' : 'reportFailed');
      setError(
        describeAuthedFailure(
          reported.status,
          reported.sessionFailure,
          describeBuyReportError,
        ),
      );
      return;
    }
    setStatus('submitted');
  }, [order, transaction, signAndSend]);

  /**
   * Re-report the submitted order (idempotent). Used from `reportFailed`, where
   * a transient Panta failure or a session that had just expired left an on-chain
   * order unrecorded. Bounded retries happen inside `reportOrder`, on 503 only.
   */
  const report = useCallback(async () => {
    if (!order || !signature) {
      setError('Prepare the order again before reporting it.');
      return;
    }
    setError(null);
    const reported = await reportOrder(order.orderId, signature);
    if (!reported.ok) {
      // 409 is a refusal retrying cannot fix (our route maps the upstream
      // QUOTE_EXPIRED to 409); anything else may be transient, so it stays
      // retryable and keeps offering the idempotent re-report.
      setStatus(reported.status === 409 ? 'reportRefused' : 'reportFailed');
      setError(
        describeAuthedFailure(
          reported.status,
          reported.sessionFailure,
          describeBuyReportError,
        ),
      );
      return;
    }
    setStatus('submitted');
  }, [order, signature]);

  return { status, error, quote, signature, prepare, confirm, report, reset };
}

/**
 * Map a signer-gate failure to fixed copy. `describeSignRequestError` already
 * returns user-safe strings; the extra branch here only adds retry guidance.
 */
function signErrorMessage(error: SignRequestError): string {
  if (error.kind === 'no-wallet' || error.kind === 'unauthenticated') {
    return 'Reconnect your wallet to sign.';
  }
  return describeSignRequestError(error);
}

/**
 * The report retry policy.
 *
 * Panta indexes from the chain, so a report sent the instant after the send
 * legitimately answers `TX_NOT_FOUND` — which our route maps to 503, a "not
 * recorded yet" state, NOT "nothing happened" — until it catches up. A retry
 * re-sends the SAME orderId + signature, so it can neither place a second order
 * nor spend again.
 *
 * Never retried: 409/400 (a refused body or a finished session — retrying tells
 * the user nothing new) and anything else that is not 503.
 */
const REPORT_RETRY_DELAYS_MS = [750, 1_500, 3_000, 3_000] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** POST the report, retrying transient (503) answers only. Idempotent per call. */
async function reportOrder(
  orderId: string,
  signature: string,
): Promise<Awaited<ReturnType<typeof authedJson>>> {
  const send = () =>
    authedJson('/api/panta/buy/submit', {
      method: 'POST',
      body: { orderId, signature },
    });
  let res = await send();
  for (const delay of REPORT_RETRY_DELAYS_MS) {
    if (res.ok || res.status !== 503) break;
    await sleep(delay);
    res = await send();
  }
  return res;
}
