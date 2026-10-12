/**
 * wallet-pill — auth state pill (client island).
 * Signed out: shows "Connect wallet" once the SDK is ready; while the Privy SDK
 * is still initialising the button shows a spinner and "Setting up…" (disabled +
 * aria-busy) so the init window reads as progress, not a dead button.
 * Signed in, wallet linked: shows truncated address + dot + menu.
 * Signed in, NO wallet: shows "Link wallet" affordance — with embedded wallets
 * disabled (see privy-provider.tsx), a wallet-less account cannot sign, so the
 * pill must push the user toward linking their own (external) wallet.
 *
 * Both paths open OUR auth modal (components/auth/auth-modal.tsx) — there is
 * no Privy modal in this app anymore. Signing in and linking run the same
 * headless SIWS flow; the modal is told whether to present "log in" or "link"
 * framing.
 *
 * Also owns the SERVER SESSION MINT: the signed session cookie is created by
 * POST /api/auth/session, which nothing in the app called before this change —
 * `getSession()` server-side was always anonymous. We mint on every
 * (authenticated, wallet) transition so `requireAuth()` actually works, and we
 * re-mint automatically after a wallet is linked or swapped (the effect keys
 * on the wallet address, not just `authenticated`).
 *
 * Entry hardening: `login()` is a no-op until Privy is ready, and Privy never
 * becomes ready on an origin its dashboard does not allow (or when auth.privy.io
 * is unreachable). Rather than present a live-looking button that silently does
 * nothing, we disable it during init and surface an explicit "Login unavailable"
 * status once the grace period lapses (see usePrivyGate). This island is an
 * affordance only — it grants no privilege; the server session mint re-checks.
 */
"use client";

import { Copy, Link2, Loader2, LogOut, ShieldAlert, UserCircle, Wallet } from "lucide-react";
import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { usePrivy, useIdentityToken } from "@privy-io/react-auth";
import { usePrivyGate } from "./use-privy-gate";
import { useWallet } from "./use-wallet";
import { clearServerSession, mirrorIdentityToken, mintSession } from "./session-client";
import { AuthModal, type AuthModalMode } from "./auth-modal";

/**
 * Bounded background mint attempts for an (authenticated, wallet) transition.
 *
 * `mintSession` already retries the token-readiness race internally (small
 * backoff, ~1s), so this is only the outer bound for a slower transient failure
 * — a Privy hiccup, or a token that takes a couple of seconds to appear. NOT
 * unbounded: a wallet that permanently cannot mint must not poll the session
 * route forever, and `authedJson` re-mints on demand when the user actually acts.
 * Worst case ~4s of background retries.
 */
const MINT_MAX_ATTEMPTS = 3;
/** Base backoff between background mint attempts (ms), scaled by attempt. */
const MINT_RETRY_DELAY_MS = 1_500;

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-5)}`;
}

export const WalletPill = () => {
  const { authenticated, logout } = usePrivy();
  const { ready, unavailable } = usePrivyGate();
  const { address } = useWallet();
  const { identityToken } = useIdentityToken();

  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [modalMode, setModalMode] = React.useState<AuthModalMode | null>(null);

  const ref = React.useRef<HTMLDivElement>(null);
  // Wallet address this browser has already minted a server session for. "",
  // not null, so the ref type stays simple.
  const lastMintedWallet = React.useRef("");

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  React.useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 1200);
      return () => clearTimeout(t);
    }
  }, [copied]);

  // Mirror the SDK's cached identity token into the session client, so a mint
  // cannot fail just because `getIdentityToken()`'s internal refresh call did.
  // No network, no throw — pure read of a value the SDK already holds.
  React.useEffect(() => {
    mirrorIdentityToken(identityToken ?? null);
  }, [identityToken]);

  // Server session mint: on logout reset; on (authenticated, wallet) transition
  // mint until it lands. This is what makes requireAuth() real.
  // Fail-closed: no wallet -> no mint attempt (the route would 403 anyway).
  //
  // The ref records SUCCESS only. It used to be set BEFORE the attempt, which
  // made one transient failure permanent: the effect never re-ran for that
  // wallet, so the page kept a connected-looking pill with NO server session,
  // and every guarded route answered 401 ("sign in") to a user who was in fact
  // signed in. `mintSession` retries the token-readiness race internally; this
  // retries the remaining transient kinds on a bounded backoff.
  React.useEffect(() => {
    if (!authenticated) {
      lastMintedWallet.current = "";
      return;
    }
    if (!address || lastMintedWallet.current === address) return;

    let cancelled = false;
    const run = async () => {
      for (let attempt = 1; attempt <= MINT_MAX_ATTEMPTS; attempt += 1) {
        if (cancelled || lastMintedWallet.current === address) return;
        const result = await mintSession();
        if (cancelled) return;
        if (result.status === "ok") {
          lastMintedWallet.current = address;
          return;
        }
        // `no-wallet` is deterministic until the linked accounts change, so a
        // retry cannot fix it — stop and leave the reason to the on-demand mint
        // in authedJson, which reports it when the user actually acts.
        if (result.status === "no-wallet") return;
        await new Promise((resolve) =>
          setTimeout(resolve, MINT_RETRY_DELAY_MS * attempt),
        );
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [authenticated, address]);

  const handleConnect = () => {
    // Guarded: never open the flow before the SDK is ready (that path no-ops).
    if (ready) setModalMode("login");
  };

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // noop
    }
  };

  const handleDisconnect = () => {
    logout();
    void clearServerSession();
    setOpen(false);
  };

  if (!authenticated) {
    // Init never completed: say so instead of rendering a dead "Connect".
    if (unavailable) {
      return (
        <span
          role="status"
          title="Wallet login is unavailable. This origin must be allowlisted in the Privy dashboard, and auth.privy.io must be reachable."
          className="flex items-center gap-2 rounded-full border border-[#2D1C00]/20 bg-[#FFF2DD]/70 px-3 py-2 text-xs font-medium tracking-tight text-[#2D1C00]/60 md:px-4 md:py-2.5 md:text-sm"
        >
          <ShieldAlert className="size-3.5 md:size-4" strokeWidth={2.5} />
          <span>Login unavailable</span>
        </span>
      );
    }
    return (
      <>
        <button
          type="button"
          onClick={handleConnect}
          disabled={!ready}
          aria-busy={!ready}
          aria-label="Connect wallet"
          className="flex items-center gap-2 rounded-full border border-[#2D1C00]/25 bg-[#FFF2DD]/90 px-3 py-2 text-xs font-medium tracking-tight text-[#2D1C00] backdrop-blur transition hover:scale-102 active:scale-98 cursor-pointer disabled:cursor-wait disabled:opacity-60 md:px-4 md:py-2.5 md:text-sm"
        >
          {ready ? (
            <Wallet className="size-3.5 md:size-4" strokeWidth={2.5} />
          ) : (
            <Loader2
              className="size-3.5 md:size-4 animate-spin"
              strokeWidth={2.5}
              aria-hidden
            />
          )}
          <span>{ready ? "Connect wallet" : "Setting up…"}</span>
        </button>
        <AnimatePresence>
          {modalMode && (
            <AuthModal mode={modalMode} onClose={() => setModalMode(null)} />
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Wallet menu"
          className="flex items-center justify-center gap-2 rounded-full border border-[#2D1C00]/15 bg-[#FFF2DD]/90 px-4 py-2 text-xs font-medium tracking-tight text-[#2D1C00] backdrop-blur transition hover:scale-102 active:scale-98 cursor-pointer md:px-4 md:py-2.5 md:text-sm"
        >
          <span className="font-mono font-semibold tracking-tight">
            {address ? truncateAddress(address) : "Link wallet"}
          </span>
          <UserCircle className="size-5" strokeWidth={2} />
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, transform: "scale(0.97) translateY(-4px)" }}
              animate={{ opacity: 1, transform: "scale(1) translateY(0px)" }}
              exit={{ opacity: 0, transform: "scale(0.97) translateY(-4px)" }}
              transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
              className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-[#2D1C00]/10 bg-[#FFF2DD] shadow-xs"
              style={{ transformOrigin: "top right" }}
            >
            {address && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex w-full items-center gap-2 px-4 py-2 transition-all text-left text-xs font-medium tracking-tight text-[#2D1C00] transition hover:bg-[#2D1C00]/5 md:text-sm"
              >
                <Copy className="size-3.5" />
                <span>{copied ? "Copied!" : "Copy address"}</span>
              </button>
            )}
            {!address && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setModalMode("link");
                  }}
                  className="cursor-pointer flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium tracking-tight text-[#2D1C00] transition hover:bg-[#2D1C00]/5 md:text-sm"
                >
                  <Link2 className="size-3.5" />
                  <span>Link wallet</span>
                </button>
                <p className="px-4 pb-2 pt-1 text-[11px] leading-snug text-[#2D1C00]/50">
                  You need a Solana wallet to back markets. Connect your wallet you would use to sign.
                </p>
              </>
            )}
            <button
              type="button"
              onClick={handleDisconnect}
              className="cursor-pointer flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium tracking-tight text-[#2D1C00] transition hover:bg-[#2D1C00]/5 md:text-sm"
            >
              <LogOut className="size-3.5" />
              <span>Disconnect</span>
            </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {modalMode && (
          <AuthModal mode={modalMode} onClose={() => setModalMode(null)} />
        )}
      </AnimatePresence>
    </>
  );
};