import { describe, expect, it } from 'vitest';
import type { Session } from '@/types/auth';
import { sessionIdSchema, userIdSchema } from '@/types/auth';
import { walletAddressSchema } from '@/types/ids';
import { decodeSessionCookie, encodeSessionCookie } from './session-cookie';

const ENV = { SESSION_SECRET: 'a'.repeat(48) };
const WALLET = 'So11111111111111111111111111111111111111112';

const IDENTITY = {
  userId: userIdSchema.parse('did:privy:abc123'),
  wallet: walletAddressSchema.parse(WALLET),
  linkedAt: 1_700_000_000,
};

const session = (): Session => ({
  id: sessionIdSchema.parse('1234567890abcdef'),
  identity: IDENTITY,
  createdAt: 1_700_000_000,
  expiresAt: 1_800_000_000,
});

describe('session envelope', () => {
  it('round-trips an authenticated session', () => {
    const value = encodeSessionCookie(session(), ENV);
    expect(value).not.toBeNull();
    const decoded = decodeSessionCookie(value as string, ENV);
    expect(decoded?.identity?.wallet).toBe(WALLET);
    expect(decoded?.identity?.userId).toBe('did:privy:abc123');
    expect(decoded?.expiresAt).toBe(1_800_000_000);
  });

  it('round-trips an anonymous session', () => {
    const anon: Session = {
      id: sessionIdSchema.parse('1234567890abcdef'),
      identity: null,
      createdAt: 1,
      expiresAt: 2,
    };
    const decoded = decodeSessionCookie(
      encodeSessionCookie(anon, ENV) as string,
      ENV,
    );
    expect(decoded?.identity).toBeNull();
  });

  it('rejects a tampered payload (forged identity)', () => {
    // Phase 3 (forged cookie): re-encode a different identity body but keep the
    // original signature — the HMAC must not match.
    const value = encodeSessionCookie(session(), ENV) as string;
    const [version, , signature] = value.split('.');
    const forgedBody = Buffer.from(
      JSON.stringify({
        ...session(),
        identity: { ...IDENTITY, wallet: 'attacker-controlled' },
      }),
      'utf8',
    ).toString('base64url');
    expect(
      decodeSessionCookie(`${version}.${forgedBody}.${signature}`, ENV),
    ).toBeNull();
  });

  it('rejects an envelope signed with a different secret', () => {
    const value = encodeSessionCookie(session(), ENV) as string;
    expect(
      decodeSessionCookie(value, { SESSION_SECRET: 'b'.repeat(48) }),
    ).toBeNull();
  });

  it('decodes to null when the secret is missing or weak (fail closed)', () => {
    const value = encodeSessionCookie(session(), ENV) as string;
    expect(decodeSessionCookie(value, {})).toBeNull();
    expect(decodeSessionCookie(value, { SESSION_SECRET: 'short' })).toBeNull();
  });

  it('refuses to encode when the secret is missing or weak (fail closed)', () => {
    expect(encodeSessionCookie(session(), {})).toBeNull();
    expect(encodeSessionCookie(session(), { SESSION_SECRET: 'short' })).toBeNull();
  });

  it('rejects a bad envelope version', () => {
    const value = encodeSessionCookie(session(), ENV) as string;
    const [, payload, signature] = value.split('.');
    expect(decodeSessionCookie(`v2.${payload}.${signature}`, ENV)).toBeNull();
  });

  it('rejects malformed values', () => {
    expect(decodeSessionCookie('garbage', ENV)).toBeNull();
    expect(decodeSessionCookie('a.b', ENV)).toBeNull();
    expect(decodeSessionCookie('', ENV)).toBeNull();
    expect(decodeSessionCookie('v1..', ENV)).toBeNull();
  });
});
