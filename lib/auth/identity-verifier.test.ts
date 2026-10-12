import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrivyIdentityVerifier } from './identity-verifier';

// The SDK is mocked so the verifier's branching (token -> wallet -> error
// mapping) is exercised without a network call or a real app secret.
const { verifyAuthToken, getUserById } = vi.hoisted(() => ({
  verifyAuthToken: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock('@privy-io/server-auth', () => ({
  PrivyClient: class {
    verifyAuthToken(...args: unknown[]) {
      return verifyAuthToken(...args);
    }
    getUserById(...args: unknown[]) {
      return getUserById(...args);
    }
  },
}));

const WALLET = 'So11111111111111111111111111111111111111112';
const TOKEN = 'privy-access-token';
const CONFIG = { appId: 'app-id', appSecret: 'app-secret' };

describe('createPrivyIdentityVerifier', () => {
  beforeEach(() => {
    verifyAuthToken.mockReset();
    getUserById.mockReset();
  });

  it('resolves a linked Solana wallet into an identity', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'did:privy:abc' });
    getUserById.mockResolvedValue({
      linkedAccounts: [{ type: 'wallet', chainType: 'solana', address: WALLET }],
    });
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken(TOKEN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBe('did:privy:abc');
      expect(result.value.wallet).toBe(WALLET);
    }
  });

  it('keys the wallet lookup on the VERIFIED userId, never on caller input', async () => {
    // Phase 3 (wallet substitution): the user record fetched must be the one for
    // the `sub` in the signature we checked — not the raw token, and not
    // anything a caller could have supplied alongside it.
    verifyAuthToken.mockResolvedValue({ userId: 'did:privy:abc' });
    getUserById.mockResolvedValue({ linkedAccounts: [] });
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    await verifier.verifyToken(TOKEN);
    expect(getUserById).toHaveBeenCalledWith('did:privy:abc');
    expect(getUserById).not.toHaveBeenCalledWith(TOKEN);
  });

  it('ignores non-Solana wallets -> no-wallet (403)', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'did:privy:abc' });
    getUserById.mockResolvedValue({
      linkedAccounts: [
        { type: 'wallet', chainType: 'ethereum', address: '0xdeadbeef' },
      ],
    });
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: 'forbidden', reason: 'no-wallet' });
    }
  });

  it('never trusts a wallet that is not linked on the user', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'did:privy:abc' });
    getUserById.mockResolvedValue({ linkedAccounts: [] });
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken(TOKEN);
    expect(result.ok).toBe(false);
  });

  it('returns unauthorized when the token does not verify', async () => {
    verifyAuthToken.mockRejectedValue(new Error('invalid token'));
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken(TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'unauthorized' });
  });

  it('does not look up a user for a token that failed to verify', async () => {
    // Fail-closed ordering: an unverified token must not cause a privileged
    // user-record lookup, so a garbage token cannot probe our Privy account.
    verifyAuthToken.mockRejectedValue(new Error('invalid token'));
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    await verifier.verifyToken(TOKEN);
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('returns unavailable when the identity provider is unreachable', async () => {
    verifyAuthToken.mockResolvedValue({ userId: 'did:privy:abc' });
    getUserById.mockRejectedValue(new Error('network'));
    const verifier = await createPrivyIdentityVerifier(CONFIG);
    const result = await verifier.verifyToken(TOKEN);
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
