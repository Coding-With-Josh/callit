import { describe, it, expect } from 'vitest';
import { base58Decode, isValidSolanaAddress } from './wallet';

describe('wallet address validation', () => {
  it('accepts a real 32-byte address', () => {
    // Wrapped SOL mint: a well-known valid Solana address.
    expect(isValidSolanaAddress('So11111111111111111111111111111111111111112')).toBe(true);
  });

  it('decodes leading-ones to leading zero bytes (32 ones = 32 zero bytes)', () => {
    const decoded = base58Decode('11111111111111111111111111111111');
    expect(decoded).not.toBeNull();
    expect(decoded?.length).toBe(32);
  });

  it('rejects a string of the right shape but the wrong length', () => {
    // 31 ones -> 31 bytes, not 32. A plain length check on the string would fail here.
    expect(isValidSolanaAddress('1111111111111111111111111111111')).toBe(false);
    expect(isValidSolanaAddress('111111111111111111111111111111111')).toBe(false);
  });

  it('rejects characters outside the base58 alphabet', () => {
    expect(base58Decode('0OIl')).toBeNull();
    expect(isValidSolanaAddress('not a real address !!')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(base58Decode('')).toBeNull();
  });
});
