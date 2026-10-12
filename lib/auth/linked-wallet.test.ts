/**
 * Tests for the linked-wallet selection rule.
 *
 * This rule picks the wallet that authorizes create/buy, so the cases that
 * matter are the ones where a wrong answer would hand a caller a different fee
 * payer: a non-Solana account, an unparseable address, or no account at all.
 */
import { describe, expect, it } from 'vitest';
import { selectLinkedSolanaWallet } from './linked-wallet';

const SOL = 'So11111111111111111111111111111111111111112';
// A second real Solana pubkey (the SPL Token program id).
const SOL_2 = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ETH_LIKE = '0x1234567890abcdef1234567890abcdef12345678';
// Right base58 alphabet, 43 chars -> decodes to ~31.5 bytes, i.e. NOT a 32-byte
// Solana key. (This is the shape of a plausible-looking but invalid address.)
const SHORT = 'Creator1111111111111111111111111111111';

describe('selectLinkedSolanaWallet', () => {
  it('selects a linked Solana wallet', () => {
    const wallet = selectLinkedSolanaWallet([
      { type: 'wallet', chainType: 'solana', address: SOL },
    ]);
    expect(wallet).toBe(SOL);
  });

  it('skips accounts that are not a Solana wallet', () => {
    // An ethereum wallet, a non-wallet account, and an email-like entry must
    // never be promoted to the fee payer.
    const wallet = selectLinkedSolanaWallet([
      { type: 'wallet', chainType: 'ethereum', address: ETH_LIKE },
      { type: 'email', chainType: 'solana', address: SOL },
      { type: 'wallet', chainType: 'solana', address: SOL_2 },
    ]);
    expect(wallet).toBe(SOL_2);
  });

  it('skips an unparseable address but still finds a later valid one', () => {
    const wallet = selectLinkedSolanaWallet([
      { type: 'wallet', chainType: 'solana', address: SHORT },
      { type: 'wallet', chainType: 'solana', address: '' },
      { type: 'wallet', chainType: 'solana', address: SOL },
    ]);
    expect(wallet).toBe(SOL);
  });

  it('returns null when no usable Solana wallet exists (fail closed)', () => {
    expect(selectLinkedSolanaWallet([])).toBeNull();
    expect(
      selectLinkedSolanaWallet([{ type: 'wallet', chainType: 'solana', address: SHORT }]),
    ).toBeNull();
    expect(selectLinkedSolanaWallet([{ type: 'wallet' }])).toBeNull();
  });
});
