/**
 * auth/auth-modal — Callit's OWN authentication modal (wallet-only).
 *
 * No Privy UI is used. Wallets are listed from the wallet-standard registry
 * (`useStandardWallets`) with Phantom / Backpack / Solflare pinned first, and
 * the user authenticates by signing a Privy SIWS message with their connected
 * wallet — the same wallet they can use on X. This is Privy's documented
 * headless "SIWS implementation without Privy UIs" flow
 * (`useLoginWithSiws` / `useLinkWithSiws`).
 *
 * Boundary notes (Phase 1/3 of the auth model):
 *  - B1 connect (`standard:connect`): the wallet address comes from the
 *    extension's returned account — this modal NEVER accepts an address from
 *    text input, so no spoofable address field exists.
 *  - B2 SIWS: Privy's backend verifies the ed25519 signature over the SIWS
 *    message it generated (the message embeds the connected address, nonce,
 *    expiry), so a signature produced by any other wallet is rejected and a
 *    captured message cannot be replayed.
 *  - Link-escalation guard: when authenticated and the connected address
 *    EQUALS the session identity wallet we reconnect WITHOUT SIWS (no
 *    duplicate link). `linkWithSiws` runs only for a genuinely new address.
 *  - Late-approval guard: if the modal is closed mid-connect, results are
 *    ignored (activeRef) — a wallet approval that lands after close can never
 *    log the user in behind their back.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLinkWithSiws, useLoginWithSiws, usePrivy } from '@privy-io/react-auth';
import {
  type SolanaStandardWallet,
  useStandardWallets,
} from '@privy-io/react-auth/solana';
import { getBase64Decoder } from '@solana/kit';
import { Loader2, ShieldAlert, Wallet, X } from 'lucide-react';
import { useWallet } from './use-wallet';

export type AuthModalMode = 'login' | 'link';

/** Wallets pinned to the top of the picker, in this order. */
const PREFERRED_WALLETS = ['Phantom', 'Backpack', 'Solflare'];
const MAINNET_CHAIN = 'solana:mainnet';

type ConnectedAccount = NonNullable<SolanaStandardWallet['accounts'][number]>;

type FlowState =
  | { readonly status: 'idle' }
  | { readonly status: 'connecting'; readonly walletName: string }
  | { readonly status: 'signing'; readonly walletName: string }
  | { readonly status: 'error'; readonly message: string };

interface AuthModalProps {
  readonly mode: AuthModalMode;
  readonly onClose: () => void;
}

export function AuthModal({ mode, onClose }: AuthModalProps) {
  const { authenticated } = usePrivy();
  const { wallet: identityWallet } = useWallet();
  const { wallets, ready: walletsReady } = useStandardWallets();
  const login = useLoginWithSiws();
  const link = useLinkWithSiws();

  const [flow, setFlow] = useState<FlowState>({ status: 'idle' });
  // Ignore results after the modal is closed (late wallet approvals).
  const activeRef = useRef(true);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Mainnet-capable wallets that can sign a message, Phantom/Backpack/Solflare
  // first, then the rest alphabetically. Fail-closed: wallets without
  // solana:signMessage cannot authenticate and are hidden.
  const candidates = useMemo(() => {
    if (!walletsReady) return [];
    const usable = wallets.filter(
      (w) => w.chains.includes(MAINNET_CHAIN) && !!w.features['solana:signMessage'],
    );
    const preferred = PREFERRED_WALLETS.map((name) =>
      usable.find((w) => w.name === name),
    ).filter((w): w is SolanaStandardWallet => !!w);
    const rest = usable
      .filter((w) => !PREFERRED_WALLETS.includes(w.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...preferred, ...rest];
  }, [wallets, walletsReady]);

  const signSiws = useCallback(
    async (
      wallet: SolanaStandardWallet,
      account: ConnectedAccount,
      message: string,
    ): Promise<string> => {
      const signMessage = wallet.features['solana:signMessage'];
      if (!signMessage) {
        throw new Error('This wallet cannot sign messages here.');
      }
      const [out] = await signMessage.signMessage({
        account,
        message: new TextEncoder().encode(message),
      });
      // Privy expects the signature base64-encoded (@scure/base convention).
      // kit 8.4.0's getBase64Decoder takes BYTES and returns the base64 text.
      return getBase64Decoder().decode(out.signature);
    },
    [],
  );

  const handleSelect = useCallback(
    async (wallet: SolanaStandardWallet) => {
      if (flow.status === 'connecting' || flow.status === 'signing') return;
      setFlow({ status: 'connecting', walletName: wallet.name });
      try {
        const connect = wallet.features['standard:connect'];
        if (!connect) {
          throw new Error('This wallet cannot connect here.');
        }
        const { accounts } = await connect.connect();
        const account = accounts[0];
        if (!account) {
          throw new Error('The wallet returned no account.');
        }
        const address = String(account.address);

        setFlow({ status: 'signing', walletName: wallet.name });

        if (!authenticated) {
          // Log in: the connected wallet IS the identity.
          const message = await login.generateSiwsMessage({ address });
          const signature = await signSiws(wallet, account, message);
          await login.loginWithSiws({ message, signature });
        } else if (identityWallet && address !== identityWallet) {
          // Link a genuinely new wallet to the existing account.
          const message = await link.generateSiwsMessage({ address });
          const signature = await signSiws(wallet, account, message);
          await link.linkWithSiws({ message, signature });
        }
        // authenticated + same address => reconnect only, no SIWS, no link.

        if (activeRef.current) onClose();
      } catch (e) {
        if (!activeRef.current) return;
        setFlow({ status: 'error', message: friendlyMessage(e) });
      }
    },
    [
      flow.status,
      authenticated,
      identityWallet,
      login,
      link,
      signSiws,
      onClose,
    ],
  );

  const busy = flow.status === 'connecting' || flow.status === 'signing';
  const busyName = flow.status === 'connecting' || flow.status === 'signing' ? flow.walletName : '';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#2D1C00]/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'login' ? 'Connect wallet' : 'Link wallet'}
        className="w-full max-w-sm overflow-hidden rounded-3xl border border-[#2D1C00]/10 bg-[#FFF2DD] shadow-2xl"
      >
        <header className="flex items-center justify-between px-6 pt-6">
          <svg
            width="76"
            height="24"
            viewBox="0 0 76 24"
            role="img"
            aria-label="callit"
            xmlns="http://www.w3.org/2000/svg"
          >
            <text
              x="0"
              y="19"
              fill="currentColor"
              className="text-[#2D1C00]"
              style={{ fontFamily: 'var(--font-tusker-9800)' }}
              fontSize="21"
              letterSpacing="-0.02em"
            >
              callit
            </text>
          </svg>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-full p-1.5 text-[#2D1C00]/50 transition hover:bg-[#2D1C00]/5 hover:text-[#2D1C00]"
          >
            <X className="size-4" strokeWidth={2.5} />
          </button>
        </header>

        <div className="px-6 pt-4">
          <h2 className="font-tusker-9800 text-2xl tracking-tight text-[#2D1C00]">
            {mode === 'login' ? 'Connect your wallet' : 'Link a wallet'}
          </h2>
          <p className="mt-1.5 text-sm leading-snug text-[#2D1C00]/60">
            {mode === 'login'
              ? 'Back the markets you believe in. Your wallet is your account — the same one you can use on X.'
              : 'Your account has no wallet yet. Add the one you use on X.'}
          </p>
        </div>

        <div className="px-6 py-5">
          {busy ? (
            <div className="flex items-center gap-3 rounded-2xl border border-[#2D1C00]/10 bg-[#FFF2DD]/60 px-4 py-4">
              <Loader2 className="size-5 animate-spin text-[#2D1C00]" strokeWidth={2.5} />
              <div>
                <p className="text-sm font-medium tracking-tight text-[#2D1C00]">
                  {flow.status === 'connecting' ? 'Waiting for your wallet…' : 'Confirm the sign-in…'}
                </p>
                <p className="text-xs text-[#2D1C00]/50">
                  {busyName} — {flow.status === 'connecting' ? 'approve the connection' : 'sign the message'}
                </p>
              </div>
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#2D1C00]/10 bg-[#FFF2DD]/60 px-4 py-6 text-center">
              <ShieldAlert className="size-5 text-[#2D1C00]/50" strokeWidth={2} />
              <p className="text-sm leading-snug text-[#2D1C00]/70">
                {walletsReady
                  ? 'No compatible wallets found. Install Phantom, Backpack, or Solflare, then refresh.'
                  : 'Checking for wallets…'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {candidates.map((wallet) => (
                <button
                  key={wallet.name}
                  type="button"
                  onClick={() => void handleSelect(wallet)}
                  className="group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-[#2D1C00]/10 bg-[#FFF2DD]/60 px-4 py-3 text-left transition hover:border-[#2D1C00]/25 hover:bg-[#2D1C00]/5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- wallet.icon is a data: URI from the extension itself */}
                  <img
                    src={wallet.icon}
                    alt=""
                    className="size-8 rounded-lg"
                    width={32}
                    height={32}
                  />
                  <span className="flex-1">
                    <span className="block text-sm font-semibold tracking-tight text-[#2D1C00]">
                      {wallet.name}
                    </span>
                    {PREFERRED_WALLETS.includes(wallet.name) && (
                      <span className="block text-[11px] text-[#2D1C00]/40">Recommended</span>
                    )}
                  </span>
                  <Wallet className="size-4 text-[#2D1C00]/30 transition group-hover:text-[#2D1C00]" strokeWidth={2} />
                </button>
              ))}
            </div>
          )}

          {flow.status === 'error' && (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs leading-snug text-red-800"
            >
              {flow.message}
            </p>
          )}

          <p className="mt-4 text-center text-[11px] tracking-tight text-[#2D1C00]/35">
            Authentication by Privy · your keys stay in your wallet
          </p>
        </div>
      </div>
    </div>
  );
}

function friendlyMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  if (/reject|declined|cancelled|cancel/i.test(msg)) {
    return 'Connection was declined in your wallet.';
  }
  if (/siws|sign in with solana|not enabled/i.test(msg)) {
    return 'Solana login is not enabled for this app yet — check the Privy dashboard (Wallet auth).';
  }
  return 'Something went wrong connecting your wallet. Try again.';
}