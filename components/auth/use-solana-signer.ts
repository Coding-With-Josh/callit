/**
 * auth/use-solana-signer — the REAL external-wallet signing path.
 *
 * Resolves the connected Solana standard wallet from Privy
 * (`useWallets` from the `@privy-io/react-auth/solana` subpath — the ROOT
 * `useWallets` is the EVM-only interface and must not be used here), runs the
 * fail-closed signer gate from lib/solana/sign, and prompts the wallet to
 * sign. Replaces the setTimeout stub pattern; the future create/buy adapters
 * consume `sign(transactionB64)` which speaks Panta's `unsignedTransactionB64`
 * format and returns the base58 signature.
 *
 * Phase 3 (signer substitution / multi-sig laundering): the transaction's sole
 * required signer MUST equal BOTH the session identity wallet (client view of
 * linkedAccounts, the same source the server identity-verifier uses) AND the
 * connected wallet instance about to sign — checked before the wallet prompt.
 *
 * Phase 3 (devnet drift): the chain is pinned to `solana:mainnet` — the
 * product is mainnet-only and this file never signs for devnet/testnet.
 */
'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useWallets } from '@privy-io/react-auth/solana';
import { useCallback } from 'react';
import { err, ok, type Result } from '@/types';
import type { WalletAddress } from '@/types';
import { useWallet } from './use-wallet';
import {
  decodeUnsignedTransactionB64,
  extractSignatureFromSigned,
  getSingleRequiredSigner,
  SolanaSignError,
} from '@/lib/solana/sign';

export type SignRequestError =
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'no-wallet' }
  | { readonly kind: 'decode-failed' }
  | { readonly kind: 'not-single-signer'; readonly numRequiredSignatures: number }
  | { readonly kind: 'signer-mismatch'; readonly txSigner: string; readonly expected: string }
  | { readonly kind: 'wallet-rejected'; readonly message: string };

export interface SignedTransaction {
  readonly signedTransaction: Uint8Array;
  /** base58 ed25519 signature — parse with `txSignatureSchema` where needed. */
  readonly signature: string;
  readonly wallet: WalletAddress;
}

export interface SolanaSigner {
  /** Session identity wallet (linked account, client view). */
  readonly wallet: WalletAddress | null;
  /** Address of the connected standard wallet instance that would sign. */
  readonly connectedAddress: string | null;
  /** True when authenticated and a matching connected wallet is present. */
  readonly ready: boolean;
  readonly sign: (
    transactionB64: string,
  ) => Promise<Result<SignedTransaction, SignRequestError>>;
}

export function useSolanaSigner(): SolanaSigner {
  const { ready, authenticated } = usePrivy();
  const { wallet: identityWallet } = useWallet();
  // Solana-subpath hook: every wallet here is a ConnectedStandardSolanaWallet
  // (Solana-only), so there is no `.type` to filter on.
  const { wallets, ready: solanaWalletsReady } = useWallets();

  // Prefer the connected wallet whose address matches the session identity;
  // fall back to the first connected Solana wallet (fail-closed: if none,
  // `connected` is null and `sign` refuses).
  const connected =
    wallets.find((w) => w.address === identityWallet) ?? wallets[0] ?? null;

  const sign = useCallback(
    async (
      transactionB64: string,
    ): Promise<Result<SignedTransaction, SignRequestError>> => {
      if (!solanaWalletsReady || !ready || !authenticated) {
        return err({ kind: 'unauthenticated' });
      }
      if (!identityWallet) return err({ kind: 'no-wallet' });
      if (!connected) return err({ kind: 'no-wallet' });

      // 1. Gate BEFORE the wallet sees the bytes (fail closed).
      let bytes: Uint8Array;
      try {
        bytes = decodeUnsignedTransactionB64(transactionB64);
      } catch (e) {
        if (e instanceof SolanaSignError) return err({ kind: 'decode-failed' });
        throw e;
      }

      let txSigner: string;
      try {
        txSigner = getSingleRequiredSigner(bytes);
      } catch (e) {
        if (e instanceof SolanaSignError && e.kind === 'not-single-signer') {
          return err({
            kind: 'not-single-signer',
            numRequiredSignatures: e.numRequiredSignatures ?? 0,
          });
        }
        return err({ kind: 'decode-failed' });
      }

      // 2. The transaction's only signer must be the session identity wallet.
      if (txSigner !== identityWallet) {
        return err({ kind: 'signer-mismatch', txSigner, expected: identityWallet });
      }
      // 3. The wallet we are about to prompt must be that same wallet.
      if (connected.address !== identityWallet) {
        return err({
          kind: 'signer-mismatch',
          txSigner: connected.address ?? '',
          expected: identityWallet,
        });
      }

      // 4. Prompt the user's wallet. Mainnet-only, per the product model.
      let signedTransaction: Uint8Array;
      try {
        const out = await connected.signTransaction({
          transaction: bytes,
          chain: 'solana:mainnet',
        });
        signedTransaction = out.signedTransaction;
      } catch (e) {
        return err({
          kind: 'wallet-rejected',
          message: e instanceof Error ? e.message : 'unknown wallet error',
        });
      }

      // 5. The wallet must have returned a fully-signed transaction.
      let signature: string;
      try {
        signature = extractSignatureFromSigned(signedTransaction);
      } catch (e) {
        return err({
          kind: 'wallet-rejected',
          message:
            e instanceof Error ? e.message : 'wallet returned an invalid signature',
        });
      }

      return ok({ signedTransaction, signature, wallet: identityWallet });
    },
    [ready, solanaWalletsReady, authenticated, identityWallet, connected],
  );

  return {
    wallet: identityWallet,
    connectedAddress: connected?.address ?? null,
    ready: ready && solanaWalletsReady && authenticated && !!identityWallet && !!connected,
    sign,
  };
}