"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

/**
 * auth/use-privy-gate — the single place that decides whether the login entry
 * point is actually usable.
 *
 * Why this exists: `login()` is a silent no-op until the Privy SDK reports
 * `ready`. The SDK only initialises for origins allowlisted in the Privy
 * dashboard (and only if `auth.privy.io` is reachable), so a disallowed origin,
 * an ad-blocker, or a network block leaves `ready === false` forever. The plain
 * "Connect" button then looks clickable and does nothing, with no error. This
 * hook turns that into an explicit state a component can render.
 *
 * `unavailable` flips true only after a generous grace period, so a merely-slow
 * SDK init is not misreported as a hard failure.
 *
 * NOTE: this is a client affordance only. It grants no privilege and is not a
 * trust boundary — the server session mint (POST /api/auth/session) re-checks
 * identity independently and fails closed regardless of what this returns.
 */

const INIT_GRACE_MS = 10_000;

export interface PrivyGate {
  /** SDK finished initialising; `login()` is safe to call. */
  readonly ready: boolean;
  /** A Privy session exists in this browser. */
  readonly authenticated: boolean;
  /** `ready` never arrived within the grace period — treat login as broken. */
  readonly unavailable: boolean;
  readonly login: () => void;
  readonly logout: () => void;
}

export function usePrivyGate(): PrivyGate {
  const { ready, authenticated, login, logout } = usePrivy();
  const [graceElapsed, setGraceElapsed] = useState(false);

  // Start one grace timer on mount. We never need to reset it: `unavailable`
  // below is `!ready && graceElapsed`, so once `ready` becomes true it stays
  // false regardless of the timer. Setting state synchronously in an effect is
  // disallowed by react-hooks/set-state-in-effect, hence the single-shot timer.
  useEffect(() => {
    const t = setTimeout(() => setGraceElapsed(true), INIT_GRACE_MS);
    return () => clearTimeout(t);
  }, []);

  return {
    ready,
    authenticated,
    unavailable: !ready && graceElapsed,
    login,
    logout,
  };
}
