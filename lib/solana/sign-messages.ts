/**
 * solana/sign-messages — user-facing text for the signer gate's failure kinds.
 *
 * The `SignRequestError` type is imported type-only, so this module carries no
 * runtime dependency on the client hook (or on Privy) and can be used by the
 * /dev route and the product surfaces alike.
 *
 * Phase 2 (no internals leak): the returned strings are fixed copy. Nothing
 * from the wallet, the transaction bytes, or an upstream response is echoed
 * into the UI.
 */
import type { SignRequestError } from '@/components/auth/use-solana-signer';

/** A short, user-safe explanation for a refused/failed signing request. */
export function describeSignRequestError(error: SignRequestError): string {
  switch (error.kind) {
    case 'unauthenticated':
      return 'Sign in to sign.';
    case 'no-wallet':
      return 'Reconnect your wallet to sign.';
    case 'decode-failed':
      return 'The transaction payload could not be read.';
    case 'not-single-signer':
      return `Refusing: the transaction requires ${error.numRequiredSignatures} signers, not 1.`;
    case 'signer-mismatch':
      return 'Refusing: the transaction is not signable by this wallet.';
    case 'wallet-rejected':
      // Fixed copy: the raw wallet message is intentionally not surfaced.
      return 'Your wallet did not sign the transaction.';
  }
  // The union is exhaustive; this is unreachable but keeps the return total.
  return 'Signing failed.';
}
