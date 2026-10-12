/**
 * solana/cluster unit tests.
 *
 * Covers the two properties that matter for this feature:
 *  - `resolveCluster` is fail-closed to mainnet for anything but the literal
 *    `'devnet'` (Phase 1, B0).
 *  - `withSiwsChain` leaves mainnet messages byte-identical, rewrites a devnet
 *    message exactly once, and throws rather than silently mis-stamping.
 */
import { describe, expect, it } from 'vitest';
import { resolveCluster, withSiwsChain } from './cluster';

/** A faithful copy of the Privy `generateSiwsMessage` shape (verified against SDK). */
function privyMessage(address: string, nonce: string): string {
  return [
    'callit-market.vercel.app wants you to sign in with your Solana account:',
    address,
    '',
    `You are proving you own ${address}.`,
    '',
    'URI: https://callit-market.vercel.app',
    'Version: 1',
    'Chain ID: mainnet',
    `Nonce: ${nonce}`,
    'Issued At: 2026-10-11T00:00:00.000Z',
    'Resources:',
    '- https://privy.io',
  ].join('\n');
}

const ADDRESS = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';

describe('resolveCluster (fail-closed)', () => {
  it('opts into devnet only for the exact literal', () => {
    expect(resolveCluster('devnet')).toBe('devnet');
  });

  it.each([undefined, null, '', 'mainnet', 'Mainnet', 'DEVNET', 'dev', 'localnet', 'testnet'])(
    'resolves %p to mainnet',
    (raw) => {
      expect(resolveCluster(raw)).toBe('mainnet');
    },
  );
});

describe('withSiwsChain', () => {
  it('leaves a mainnet message byte-identical (production pass-through)', () => {
    const message = privyMessage(ADDRESS, 'nonce-123');
    expect(withSiwsChain(message, 'mainnet')).toBe(message);
  });

  it('rewrites the Chain ID line to devnet exactly once, preserving everything else', () => {
    const message = privyMessage(ADDRESS, 'nonce-123');
    const out = withSiwsChain(message, 'devnet');
    expect(out).toContain('\nChain ID: devnet\n');
    expect(out).not.toContain('Chain ID: mainnet');
    // The nonce (the server-side binding) must be untouched.
    expect(out).toContain('Nonce: nonce-123');
    expect(out.split('Chain ID:').length - 1).toBe(1);
  });

  it('throws when there is no Chain ID line to stamp (fail closed)', () => {
    expect(() => withSiwsChain('some other message', 'devnet')).toThrowError(
      /no "Chain ID" line/,
    );
  });

  it('does not treat a mid-line "Chain ID" as the header', () => {
    // Anchored to line start: an embedded substring must not satisfy it.
    const smuggle = privyMessage(ADDRESS, 'n').replace('Chain ID: mainnet', 'X Chain ID: mainnet');
    expect(() => withSiwsChain(smuggle, 'devnet')).toThrowError(/no "Chain ID" line/);
  });
});
