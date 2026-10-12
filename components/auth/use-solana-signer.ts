/**
 * auth/use-solana-signer — the REAL external-wallet signing path.
 *
 * Resolves the connected Solana standard wallet that holds the session
 * identity account (from `useStandardWallets` on the
 * `@privy-io/react-auth/solana` subpath), runs the fail-closed signer gate
 * from lib/solana/sign, and prompts that wallet to sign via the
 * wallet-standard `solana:signTransaction` feature — the same headless
 * transport the custom auth modal uses for connecting, so no Privy UI is
 * involved anywhere in this flow.
 *
 * Replaces the setTimeout stub pattern; the future create/buy adapters
 * consume `sign(transactionB64)` which speaks Panta's `unsignedTransactionB64`
 * format and returns the base58 signature.
 *
 * Phase 3 (signer substitution / multi-sig laundering): the transaction's sole
 * required signer MUST equal BOTH the session identity wallet (client view of
 * linkedAccounts, the same source the server identity-verifier uses) AND the
 * connected wallet account about to sign — checked before the wallet prompt.
 * The account used for signing is the one whose address === identity wallet;
 * if that account is not currently connected we fail closed (`no-wallet`)
 * rather than silently signing with any other wallet.
 *
 * Phase 3 (devnet drift): the chain comes from the single configured cluster
 * (`SOLANA_CHAIN`), defaulting to `solana:mainnet` — the product is mainnet-only
 * and a build only carries a devnet chain when `NEXT_PUBLIC_SOLANA_CLUSTER` is
 * explicitly `devnet` for local development.
 */
'use client';

import { usePrivy } from '@privy-io/react-auth';
import {
  type SolanaStandardWallet,
  useStandardWallets,
} from '@privy-io/react-auth/solana';
import { useCallback, useMemo } from 'react';
import { err, ok, type Result } from '@/types';
import type { WalletAddress } from '@/types';
import { useWallet } from './use-wallet';
import { SOLANA_CHAIN } from '@/lib/solana/cluster';
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
  /** Address of the currently-connected wallet account that would sign. */
  readonly connectedAddress: string | null;
  /** True when authenticated and a matching connected wallet is present. */
  readonly ready: boolean;
  readonly sign: (
    transactionB64: string,
  ) => Promise<Result<SignedTransaction, SignRequestError>>;
}

type ConnectedAccount = NonNullable<SolanaStandardWallet['accounts'][number]>;

export function useSolanaSigner(): SolanaSigner {
  const { ready, authenticated } = usePrivy();
  const { wallet: identityWallet } = useWallet();
  const { wallets: standardWallets, ready: standardWalletsReady } =
    useStandardWallets();

  // The standard wallet whose connected accounts include the session identity
  // address, plus that exact account. Fail-closed: if the identity wallet is
  // not currently connected, `connected` is null and `sign` refuses — the
  // user reconnects through the auth modal, never silently through another
  // wallet.
  const connected = useMemo<{
    readonly wallet: SolanaStandardWallet;
    readonly account: ConnectedAccount;
  } | null>(() => {
    if (!identityWallet) return null;
    for (const wallet of standardWallets) {
      const account = wallet.accounts.find((a) => a.address === identityWallet);
      if (account) return { wallet, account };
    }
    return null;
  }, [standardWallets, identityWallet]);

  const sign = useCallback(
    async (
      transactionB64: string,
    ): Promise<Result<SignedTransaction, SignRequestError>> => {
      if (!standardWalletsReady || !ready || !authenticated) {
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
      // 3. The account we are about to prompt must be that same wallet.
      if (connected.account.address !== identityWallet) {
        return err({
          kind: 'signer-mismatch',
          txSigner: connected.account.address,
          expected: identityWallet,
        });
      }

      // 4. Prompt the user's wallet via its wallet-standard feature.
      //    Chain follows the configured cluster (mainnet by default).
      const signTransactionFeature = connected.wallet.features['solana:signTransaction'];
      if (!signTransactionFeature) {
        return err({
          kind: 'wallet-rejected',
          message: 'connected wallet cannot sign transactions',
        });
      }

      let signedTransaction: Uint8Array;
      try {
        const [out] = await signTransactionFeature.signTransaction({
          account: connected.account,
          transaction: bytes,
          chain: SOLANA_CHAIN,
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
    [ready, standardWalletsReady, authenticated, identityWallet, connected],
  );

  return {
    wallet: identityWallet,
    connectedAddress: connected?.account.address ?? null,
    ready: ready && standardWalletsReady && authenticated && !!identityWallet && !!connected,
    sign,
  };
}