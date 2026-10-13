'use client';

/**
 * use-price-gate — the client gate that decides whether the buy slip may be used.
 *
 * Owns: fetching a FRESH market read, running it through the pure gate in
 * lib/buy/price-check, and exposing the three things the slip needs — the state,
 * a user-triggered re-check, and a pre-quote re-check that runs immediately before
 * an order is composed.
 *
 * Phase 1 (complete mediation): this is an affordance, not the control. It can
 * only withhold our own form; the server denies independently (the quote route is
 * behind the session guard and Panta itself refuses an unpriced market, and that
 * refusal is mapped to honest copy). Worth having anyway: it is the difference
 * between "we cannot price this market right now" and letting a user compose an
 * order that cannot be quoted at all.
 *
 * Why a fresh read rather than the page's own data (Phase 2): the detail page is
 * rendered from a minutes-cached read, so a market it shows as priced may be
 * unpriced by the time the user presses the button — and vice versa. `authedJson`
 * sends `cache: 'no-store'` on a route that already answers `no-store`, so this
 * check is the current state, not the page's.
 *
 * TOCTOU, stated plainly: the window can close between this check and the quote.
 * Nothing here pretends otherwise — that is why the pre-quote check runs right
 * before composing, and why the server's own refusal is the authority. There is no
 * atomic construct available across an upstream HTTP round trip; the honest
 * mitigation is to check at the point of use AND keep the server gate.
 *
 * `checking` is DERIVED, not stored (no result for the current inputs yet), so no
 * effect has to synchronously set state to enter it, and a result that belongs to
 * older inputs can never be displayed as if it were current.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { marketIdSchema } from '@/types';
import type { DataProvenance } from '@/types';
import { authedJson } from '@/components/auth/authed-json';
import {
  checkPrice,
  derivePriceGateState,
  priceGateKey,
  probeOfResponse,
  type PriceGateResult,
  type PriceGateState,
  type PriceProbe,
  type PriceStatus,
} from '@/lib/buy/price-check';

// The state union lives with the pure gate logic (lib/buy/price-check) so it is
// testable without React; re-exported here because this module is where the UI
// gets it.
export type { PriceGateState };

export interface PriceGate {
  readonly state: PriceGateState;
  /** User-triggered re-check (the notice's button). */
  readonly recheck: () => void;
  /**
   * Re-check ONCE immediately before composing an order.
   *
   * Returns true when the caller may proceed. An `unknown` read proceeds: a failed
   * read is not evidence that the market is unpriceable, and the quote itself is
   * the authoritative check — if the market cannot be quoted the flow fails with
   * its own honest copy rather than being blocked by a broken price read.
   */
  readonly ensurePriced: () => Promise<boolean>;
}

export interface UsePriceGateOptions {
  readonly marketId: string;
  readonly provenance: DataProvenance;
  /**
   * Whether a session is present, i.e. whether the buy controls are reachable at
   * all. When false the gate never issues a request (a request would only 401 and
   * spend the shared read budget) and reports `inactive`.
   */
  readonly active: boolean;
}

export function usePriceGate({
  marketId,
  provenance,
  active,
}: UsePriceGateOptions): PriceGate {
  const [result, setResult] = useState<PriceGateResult | null>(null);
  const key = priceGateKey(marketId, provenance, active);

  // Only the newest check may write: an answer that arrives after the inputs
  // changed is stale by definition, and a stale "priced" is the one wrong answer
  // that could let a form through.
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const probeOnce = useCallback(async (): Promise<PriceProbe> => {
    // Perimeter: the id is validated here, before it is placed in a URL. A
    // non-conforming id denies without a network call at all.
    const id = marketIdSchema.safeParse(marketId);
    if (!id.success) return { kind: 'absent' };
    const response = await authedJson(
      `/api/panta/markets/${encodeURIComponent(id.data)}`,
    );
    return probeOfResponse(response);
  }, [marketId]);

  const runCheck = useCallback(
    async (
      attempts?: number,
    ): Promise<PriceStatus | 'preview' | 'inactive'> => {
      if (provenance !== 'live') return 'preview';
      // No session: nothing to gate, and a request here would only 401.
      if (!active) return 'inactive';
      const mine = ++seq.current;
      const status = await checkPrice(
        probeOnce,
        attempts === undefined ? undefined : { attempts, delayMs: 0 },
      );
      if (mounted.current && mine === seq.current) {
        setResult({ key: priceGateKey(marketId, provenance, active), status });
      }
      return status;
    },
    [probeOnce, provenance, active, marketId],
  );

  // Establish the state for the current inputs. `checking` is what the derived
  // state says while no conclusion for THIS key exists, so nothing here has to
  // set state to enter it — the effect's only job is to start the check.
  useEffect(() => {
    if (provenance !== 'live' || !active) return;
    void runCheck();
  }, [provenance, active, runCheck]);

  const recheck = useCallback(() => {
    if (provenance !== 'live' || !active) return;
    // Drop the old conclusion first so the derived state is `checking` while the
    // new read is in flight, rather than showing a verdict we are re-testing.
    setResult(null);
    void runCheck();
  }, [provenance, active, runCheck]);

  const ensurePriced = useCallback(async (): Promise<boolean> => {
    // One attempt: the job of this check is to avoid composing an order for a
    // market we already know is unpriced, not to wait a window out — the flow's
    // own bounded re-roll and the user's re-check cover that.
    const status = await runCheck(1);
    // Deny the two states we positively know cannot be bought: an unpriced
    // window, and a fixture market (which is not a live market at all — a quote
    // for it would be a real order for a demo id). `unknown` and `inactive`
    // proceed: a failed read is not evidence of unpriceability, and the quote
    // route is the authority that will deny if it should — a silent local no-op
    // would leave the user with a dead button and no explanation.
    return status !== 'unpriced' && status !== 'preview';
  }, [runCheck]);

  const state = derivePriceGateState({ provenance, active, key, result });

  return { state, recheck, ensurePriced };
}
