'use client';

/**
 * use-buy-order — the client orchestration for a primary buy.
 *
 * Owns: the two-step flow (prepare: quote -> build -> verify -> assemble, then
 * confirm: wallet sign), the session-mint retry on a 401, and the user-facing
 * status copy. Must not construct a transaction itself — every gate lives in
 * lib/buy/client and lib/solana/assemble.
 *
 * Phase 1 (complete mediation): the hooks here call only the app's own routes
 * (`/api/panta/buy/quote`, `/api/panta/buy/build`). Those routes re-authenticate
 * the session and re-derive the wallet server-side; nothing in this hook can
 * redirect the fee payer, and the client-side `wallet` used for verification is
 * the session identity wallet from Privy, not a caller-supplied string.
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
 */
import { useCallback, useState } from 'react';
import { useSolanaSigner } from '@/components/auth/use-solana-signer';
import type { SignRequestError } from '@/components/auth/use-solana-signer';
import { mintSession } from '@/components/auth/session-client';
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
  parseBuiltOrder,
  parseBuyQuote,
  verifyBuyOrder,
} from '@/lib/buy/client';
import { describeSignRequestError } from '@/lib/solana/sign-messages';

export type BuyOrderStatus = 'idle' | 'quoting' | 'building' | 'ready' | 'signing' | 'signed';

/** The operands the user asked to buy, once each has passed its schema. */
interface PreparedRequest {
  readonly marketId: MarketId;
  readonly side: Side;
  readonly amountUsdc: UsdcDecimal;
}

type JsonResult = { readonly ok: true; readonly data: unknown } | { readonly ok: false; readonly status: number };

async function postJson(path: string, body: unknown): Promise<JsonResult> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, data: await response.json() };
  } catch {
    // Network/proxy failure. Never surface the underlying error.
    return { ok: false, status: 0 };
  }
}

/**
 * POST, and on a 401 mint a fresh server session and retry exactly once. The
 * retry is bounded so a route that always 401s cannot loop.
 */
async function authedPost(path: string, body: unknown): Promise<JsonResult> {
  const first = await postJson(path, body);
  if (first.ok || first.status !== 401) return first;
  const minted = await mintSession();
  if (minted.status !== 'ok') return first;
  return postJson(path, body);
}

/** Fixed user copy keyed by the route's HTTP status. Never the response body. */
function requestErrorMessage(status: number): string {
  if (status === 401 || status === 403) return 'Sign in to continue.';
  if (status === 400) return "That order isn't valid. Check the amount and try again.";
  if (status === 404) return 'That market is no longer available to buy.';
  if (status === 429) return 'Too many requests — wait a moment and try again.';
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
  /** Sign the prepared order. Refuses an expired or absent order (fail closed). */
  readonly confirm: () => Promise<void>;
  readonly reset: () => void;
}

export function useBuyOrder(): BuyOrderController {
  const { wallet, sign } = useSolanaSigner();
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
      const quoteRes = await authedPost('/api/panta/buy/quote', {
        marketId: request.marketId,
        side: request.side,
        amountUsdc: request.amountUsdc,
      });
      if (!quoteRes.ok) {
        setStatus('idle');
        setError(requestErrorMessage(quoteRes.status));
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
      const buildRes = await authedPost('/api/panta/buy/build', {
        quoteId: parsedQuote.value.quoteId,
      });
      if (!buildRes.ok) {
        setStatus('idle');
        setError(requestErrorMessage(buildRes.status));
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
    const signed = await sign(transaction);
    if (!signed.ok) {
      // Back to `ready` so the user can retry without re-quoting.
      setStatus('ready');
      setError(signErrorMessage(signed.error));
      return;
    }
    setSignature(signed.value.signature);
    setStatus('signed');
  }, [order, transaction, sign]);

  return { status, error, quote, signature, prepare, confirm, reset };
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
