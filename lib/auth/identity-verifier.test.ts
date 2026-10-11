import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrivyIdentityVerifier } from './identity-verifier';

// The SDK is mocked so the verifier's branching (token -> wallet -> error
// mapping) is exercised without a network call or a real app secret.
const { verifyAuthToken, getUser } = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@privy-io/server-auth', () => ({
  PrivyClient: class {
    verifyAuthToken(...args: unknown[]) {
      return verifyAuthToken(...args);
    }
    getUser(...args: unknown[]) {
      return getUser(...args);
    }
  },
}));

const WALLET = 'So11111111111111111111111111111111111111112';
const CONFIG = { appId: 'app-id', appSecret: 'app-secret' };

describe('createPrivyIdentityVerifier', () => {
  beforeEach(() => {
    verifyAuthToken.mockReset();
    getUser.mockReset();
  });

  it('resolves a linked Solana wallet into an identity', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'did:privy:abc' });
    getUser.mockResolvedValue({
      linkedAccounts: [{ type: 'wallet', chainType: 'solana', address: WALLET }],
    });
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken('token');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBe('did:privy:abc');
      expect(result.value.wallet).toBe(WALLET);
    }
  });

  it('ignores non-Solana wallets -> no-wallet (403)', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'did:privy:abc' });
    getUser.mockResolvedValue({
      linkedAccounts: [
        { type: 'wallet', chainType: 'ethereum', address: '0xdeadbeef' },
      ],
    });
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken('token');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'forbidden', reason: 'no-wallet' });
    }
  });

  it('never trusts a wallet that is not linked on the user', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'did:privy:abc' });
    getUser.mockResolvedValue({ linkedAccounts: [] });
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken('token');
    expect(result.ok).toBe(false);
  });

  it('returns unauthorized when the token does not verify', async () => {
    verifyAuthToken.mockRejectedValue(new Error('invalid token'));
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken('token');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'unauthorized' });
  });

  it('returns unavailable when the identity provider is unreachable', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'did:privy:abc' });
    getUser.mockRejectedValue(new Error('network'));
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken('token');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'unavailable' });
  });

  it('returns unauthorized for an empty token', async () => {
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'unauthorized' });
  });
});
