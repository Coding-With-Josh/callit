/**
 * wallet-pill — auth state pill (client island).
 * Signed out: shows "Connect" (disabled while the Privy SDK initialises).
 * Signed in, wallet linked: shows truncated address + dot + menu.
 * Signed in, NO wallet: shows "Link wallet" affordance — with embedded wallets
 * disabled (see privy-provider.tsx), a wallet-less account cannot sign, so the
 * pill must push the user toward linking their own (external) wallet.
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

import { Copy, Link2, LogOut, ShieldAlert, UserCircle, Wallet } from "lucide-react";
import React from "react";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyGate } from "./use-privy-gate";
import { useWallet } from "./use-wallet";
import { clearServerSession, mintSession } from "./session-client";

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-5)}`;
}

export const WalletPill = () => {
  const { authenticated, linkWallet, logout } = usePrivy();
  const { ready, unavailable, login } = usePrivyGate();
  const { address } = useWallet();

  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [linking, setLinking] = React.useState(false);
  const [linkingError, setLinkingError] = React.useState<string | null>(null);

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

  // Server session mint: on logout reset; on (authenticated, wallet) transition
  // mint exactly once per wallet. This is what makes requireAuth() real.
  // Fail-closed: no wallet -> no mint attempt (the route would 403 anyway).
  React.useEffect(() => {
    if (!authenticated) {
      lastMintedWallet.current = "";
      return;
    }
    if (address && lastMintedWallet.current !== address) {
      lastMintedWallet.current = address;
      void mintSession();
    }
  }, [authenticated, address]);

  const handleConnect = () => {
    // Guarded: never call into the SDK before it is ready (that path no-ops).
    if (ready) login();
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

  const handleLinkWallet = () => {
    setLinkingError(null);
    setLinking(true);
    try {
      // Opens Privy's external-wallet linking modal. The session re-mint
      // happens reactively in the effect above once linkedAccounts updates.
      linkWallet();
    } catch {
      setLinkingError("Could not open wallet linking");
    } finally {
      setLinking(false);
      setOpen(false);
    }
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
      <button
        type="button"
        onClick={handleConnect}
        disabled={!ready}
        aria-busy={!ready}
        aria-label="Connect wallet"
        className="flex items-center gap-2 rounded-full border border-[#2D1C00]/25 bg-[#FFF2DD]/90 px-3 py-2 text-xs font-medium tracking-tight text-[#2D1C00] backdrop-blur transition hover:scale-102 active:scale-98 cursor-pointer disabled:cursor-wait disabled:opacity-60 md:px-4 md:py-2.5 md:text-sm"
      >
        <Wallet className="size-3.5 md:size-4" strokeWidth={2.5} />
        <span>Connect wallet</span>
      </button>
    );
  }

  return (
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
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-[#2D1C00]/10 bg-[#FFF2DD] shadow-xs">
          {linkingError && (
            <p className="px-4 py-2 text-xs text-red-800">{linkingError}</p>
          )}
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
                onClick={handleLinkWallet}
                disabled={linking}
                className="cursor-pointer flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium tracking-tight text-[#2D1C00] transition hover:bg-[#2D1C00]/5 disabled:opacity-60 md:text-sm"
              >
                <Link2 className="size-3.5" />
                <span>{linking ? "Opening…" : "Link wallet"}</span>
              </button>
              <p className="px-4 pb-2 pt-1 text-[11px] leading-snug text-[#2D1C00]/50">
                You need a Solana wallet to back markets. Connect your own —
                the same one you can use on X.
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
        </div>
      )}
    </div>
  );
};