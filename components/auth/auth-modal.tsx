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
 * Rendering: the modal is PORTALED to <body> (createPortal). It must NOT live
 * inside the navbar/wallet-pill subtree: the navbar carries `backdrop-blur`,
 * and any ancestor with backdrop-filter/filter/transform becomes the
 * containing block for `position: fixed` descendants — that trapped the
 * backdrop in the navbar instead of covering the viewport. Portal + z-[100]
 * guarantees a true full-page overlay. Enter/exit animation is Motion:
 * backdrop fade, panel spring pop, staggered wallet rows (reduced-motion
 * aware — transform is dropped, opacity-only).
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
import { createPortal } from 'react-dom';
import { useLinkWithSiws, useLoginWithSiws, usePrivy } from '@privy-io/react-auth';
import {
  type SolanaStandardWallet,
  useStandardWallets,
} from '@privy-io/react-auth/solana';
import { getBase64Decoder } from '@solana/kit';
import { motion, useReducedMotion, type Variants } from 'motion/react';
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

  // Portal guard: only render once on the client (document.body exists).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

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

  // Motion: honour prefers-reduced-motion — fade only, no transform.
  const reduce = useReducedMotion();

  const panelVariants = useMemo<Variants>(
    () =>
      reduce
        ? {
            initial: { opacity: 0 },
            animate: { opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } },
            exit: { opacity: 0, transition: { duration: 0.15, ease: 'easeIn' } },
          }
        : {
            initial: { opacity: 0, transform: 'scale(0.96) translateY(12px)' },
            animate: {
              opacity: 1,
              transform: 'scale(1) translateY(0px)',
              transition: { type: 'spring', duration: 0.5, bounce: 0.15 },
            },
            exit: {
              opacity: 0,
              transform: 'scale(0.97) translateY(8px)',
              transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
            },
          },
    [reduce],
  );

  const listVariants = useMemo<Variants>(
    () => ({
      hidden: {},
      visible: { transition: { staggerChildren: 0.05, delayChildren: 0.12 } },
    }),
    [],
  );

  const rowVariants = useMemo<Variants>(
    () =>
      reduce
        ? {
            hidden: { opacity: 0 },
            visible: { opacity: 1, transition: { duration: 0.25, ease: 'easeOut' } },
          }
        : {
            hidden: { opacity: 0, transform: 'translateY(10px)' },
            visible: {
              opacity: 1,
              transform: 'translateY(0px)',
              transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] },
            },
          },
    [reduce],
  );

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
      // Which async step threw — makes the next failure diagnosable.
      let step = 'connect';
      try {
        // Some Solana wallets implement the older `solana:connect` feature
        // instead of `standard:connect`; try both before failing closed.
        const standardConnect = wallet.features['standard:connect'];
        const solanaConnect = (
          wallet.features as unknown as {
            'solana:connect'?: {
              connect: (input?: { silent?: boolean }) => Promise<{
                accounts: readonly ConnectedAccount[];
              }>;
            };
          }
        )['solana:connect'];
        const connectFeature = standardConnect ?? solanaConnect;
        if (!connectFeature) {
          throw new Error('This wallet cannot connect here (no connect feature).');
        }
        const { accounts } = await connectFeature.connect();
        const account = accounts[0];
        if (!account) {
          throw new Error('The wallet returned no account.');
        }
        const address = String(account.address);

        setFlow({ status: 'signing', walletName: wallet.name });

        if (!authenticated) {
          // Log in: the connected wallet IS the identity.
          step = 'generate-siws-message';
          const message = await login.generateSiwsMessage({ address });
          step = 'sign-message';
          const signature = await signSiws(wallet, account, message);
          step = 'siws-login';
          await login.loginWithSiws({ message, signature });
        } else if (identityWallet && address !== identityWallet) {
          // Link a genuinely new wallet to the existing account.
          step = 'generate-siws-message';
          const message = await link.generateSiwsMessage({ address });
          step = 'sign-message';
          const signature = await signSiws(wallet, account, message);
          step = 'siws-link';
          await link.linkWithSiws({ message, signature });
        }
        // authenticated + same address => reconnect only, no SIWS, no link.

        if (activeRef.current) onClose();
      } catch (e) {
        if (!activeRef.current) return;
        // Surface the REAL failure instead of hiding it: log the original
        // error AND the step, and show the raw text in the UI so a wrong
        // step (connect vs signMessage vs SIWS) is diagnosable, not a
        // generic copy-paste.
        console.error(`[auth-modal] step "${step}" failed:`, e);
        setFlow({ status: 'error', message: friendlyMessage(e, step) });
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
  const busyName =
    flow.status === 'connecting' || flow.status === 'signing' ? flow.walletName : '';

  if (!mounted) return null;

  return createPortal(
    <motion.div
      // Backdrop: fade only (no transform) — it covers the viewport via
      // inset-0; the portal keeps it out of the navbar's containing block.
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#2D1C00]/50 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'login' ? 'Connect wallet' : 'Link wallet'}
        variants={panelVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-[#2D1C00]/10 bg-[#FFF2DD] shadow-2xl"
      >
        <header className="flex items-center justify-between px-7 pt-7">
          <span className="font-tusker-8800 text-xl tracking-tight text-[#2D1C00]">
            callit.
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-full p-2 text-[#2D1C00]/50 transition hover:bg-[#2D1C00]/5 hover:text-[#2D1C00]"
          >
            <X className="size-4.5" strokeWidth={2.5} />
          </button>
        </header>

        <div className="px-7 pt-5">
          <h2 className="font-tusker-9800 text-[28px] leading-none tracking-tight text-[#2D1C00]">
            {mode === 'login' ? 'Connect your wallet' : 'Link a wallet'}
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-[#2D1C00]/60">
            {mode === 'login'
              ? 'Back the markets you believe in. Your wallet is your account — the same one you can use on X.'
              : 'Your account has no wallet yet. Add the one you use on X.'}
          </p>
        </div>

        <div className="px-7 pb-7 pt-6">
          {busy ? (
            <div className="flex items-center gap-4 rounded-2xl border border-[#2D1C00]/10 bg-[#FFF2DD]/60 px-5 py-5">
              <Loader2 className="size-6 animate-spin text-[#2D1C00]" strokeWidth={2.5} />
              <div>
                <p className="text-[15px] font-medium tracking-tight text-[#2D1C00]">
                  {flow.status === 'connecting'
                    ? 'Waiting for your wallet…'
                    : 'Confirm the sign-in…'}
                </p>
                <p className="mt-0.5 text-[13px] text-[#2D1C00]/50">
                  {busyName} —{' '}
                  {flow.status === 'connecting'
                    ? 'approve the connection'
                    : 'sign the message'}
                </p>
              </div>
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#2D1C00]/10 bg-[#FFF2DD]/60 px-5 py-8 text-center">
              <ShieldAlert className="size-6 text-[#2D1C00]/50" strokeWidth={2} />
              <p className="text-[15px] leading-snug text-[#2D1C00]/70">
                {walletsReady
                  ? 'No compatible wallets found. Install Phantom, Backpack, or Solflare, then refresh.'
                  : 'Checking for wallets…'}
              </p>
            </div>
          ) : (
            <motion.div
              variants={listVariants}
              initial="hidden"
              animate="visible"
              className="flex flex-col gap-2.5"
            >
              {candidates.map((wallet) => (
                <motion.button
                  key={wallet.name}
                  type="button"
                  variants={rowVariants}
                  onClick={() => void handleSelect(wallet)}
                  className="group flex w-full cursor-pointer items-center gap-4 rounded-2xl border border-[#2D1C00]/10 bg-[#FFF2DD]/60 px-5 py-4 text-left transition hover:border-[#2D1C00]/25 hover:bg-[#2D1C00]/5"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- wallet.icon is a data: URI from the extension itself */}
                  <img
                    src={wallet.icon}
                    alt=""
                    className="size-11 rounded-xl"
                    width={44}
                    height={44}
                  />
                  <span className="flex-1">
                    <span className="block text-[15px] font-semibold tracking-tight text-[#2D1C00]">
                      {wallet.name}
                    </span>
                    {PREFERRED_WALLETS.includes(wallet.name) && (
                      <span className="mt-0.5 block text-xs text-[#2D1C00]/40">
                        Recommended
                      </span>
                    )}
                  </span>
                  <Wallet
                    className="size-5 text-[#2D1C00]/30 transition group-hover:text-[#2D1C00]"
                    strokeWidth={2}
                  />
                </motion.button>
              ))}
            </motion.div>
          )}

          {flow.status === 'error' && (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] leading-snug text-red-800"
            >
              {flow.message}
            </p>
          )}

          <p className="mt-6 border-t border-[#2D1C00]/10 pt-4 text-center text-xs tracking-tight text-[#2D1C00]/40">
            Authentication by Privy · your keys stay in your wallet
          </p>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function friendlyMessage(e: unknown, step: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|declined|cancelled|cancel/i.test(msg)) {
    return 'Connection was declined in your wallet.';
  }
  if (/siws|sign in with solana|not enabled|not available|not configured/i.test(msg)) {
    return 'Solana login is not enabled for this app yet — check the Privy dashboard (Wallet auth).';
  }
  // Include the raw message and the failing step so the real failure is
  // visible, not masked.
  return msg
    ? `Something went wrong at "${step}": ${msg}`
    : `Something went wrong at "${step}". Try again.`;
}