/**
 * auth/use-wallet — read linked Solana wallet (external-only model).
 *
 * Uses Privy hooks on client. Validates via `isValidSolanaAddress`.
 * The wallet list is derived structurally (never `any`) so a Privy shape change
 * degrades to "no wallet" rather than crashing the render.
 *
 * Fail-closed (Phase 3): only a linked account of type `wallet` on chainType
 * `solana` counts as an identity wallet — an EVM link is never treated as one.
 * This mirrors the server identity-verifier's resolution exactly.
 */
'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useMemo } from 'react';
import { isValidSolanaAddress, type WalletAddress } from '@/types';

export interface WalletState {
  readonly ready: boolean;
  readonly wallet: WalletAddress | null;
  readonly address: string | null;
}

interface LinkedWalletLike {
  readonly type?: string;
  readonly chainType?: string;
  readonly address?: string;
}

export function useWallet(): WalletState {
  const { ready, authenticated, user } = usePrivy();

  // Memoized so the dependent `wallet` memo below does not recompute on every
  // render (react-hooks/exhaustive-deps).
  const wallets = useMemo<readonly LinkedWalletLike[]>(() => {
    const linked = (
      user as { linkedAccounts?: readonly LinkedWalletLike[] } | null
    )?.linkedAccounts;
    if (!linked) return [];
    return linked.filter(
      (a) => a.type === 'wallet' && a.chainType === 'solana',
    );
  }, [user]);

  const wallet = useMemo<WalletAddress | null>(() => {
    if (!ready || !authenticated) return null;
    const address = wallets[0]?.address;
    if (!address) return null;
    return isValidSolanaAddress(address) ? (address as WalletAddress) : null;
  }, [ready, authenticated, wallets]);

  return {
    ready,
    wallet,
    address: wallet ?? wallets[0]?.address ?? null,
  };
}