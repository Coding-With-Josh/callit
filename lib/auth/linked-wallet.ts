/**
 * auth/linked-wallet — pick the Solana wallet that becomes the session identity.
 *
 * Pure: no Privy, no Next, no network. Extracted so the rule that decides WHICH
 * wallet is trusted can be unit-tested directly, because this is a security
 * boundary — the selected wallet becomes the fee payer on create/buy.
 *
 * Phase 3 (wallet substitution): the input is the server-side Privy user record
 * for the userId WE verified from the token signature. A caller can neither
 * supply the wallet nor influence this pick; and when the record carries no
 * usable Solana wallet the answer is `null`, which the verifier turns into a
 * 403. There is deliberately no fallback to anything the caller claims.
 */
import { walletAddressSchema, type WalletAddress } from '@/types/ids';

/** The minimal shape of a linked account that we read for wallet resolution. */
export interface LinkedAccountLike {
  readonly type?: string;
  readonly chainType?: string;
  readonly address?: string;
}

/**
 * The first linked Solana wallet with a well-formed address, or null.
 *
 * Fail-closed on every degenerate input: wrong account type, wrong chain, a
 * missing address, or an address that is not a valid 32-byte Solana key. A
 * malformed entry is skipped rather than returned, and a malformed entry does
 * not prevent a later valid one from being selected.
 */
export function selectLinkedSolanaWallet(
  accounts: readonly LinkedAccountLike[],
): WalletAddress | null {
  for (const account of accounts) {
    if (account.type !== 'wallet' || account.chainType !== 'solana') continue;
    if (!account.address) continue;
    const parsed = walletAddressSchema.safeParse(account.address);
    if (parsed.success) return parsed.data;
  }
  return null;
}
