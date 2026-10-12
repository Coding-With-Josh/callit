import { describe, it, expect } from 'vitest';
import {
  CreateClientError,
  describeCreateClientError,
  describeSourceCheckError,
  parseCreateBuild,
  parseCreateQuote,
  parseSourceVerdict,
} from './client';

const quote = {
  createId: 'cr_abc123',
  expectedEventPda: '11111111111111111111111111111111',
  paymentUsdc: '50',
  liquidityInjectionUsdc: '15',
  platformRevenueUsdc: '2.5',
  expiresAt: 1_900_000_000,
};

const build = {
  transaction: 'SGVsbG8gUGFudGE=',
  recentBlockhash: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  lastValidBlockHeight: 300_000_000,
  buildExpiresAt: 1_900_000_000,
};

describe('parseCreateQuote', () => {
  it('accepts the route payload and returns the domain quote', () => {
    expect(parseCreateQuote(quote)).toEqual(quote);
  });

  it('refuses a malformed quote instead of partially trusting it', () => {
    // Phase 2: a shape we do not recognise is a refusal, not a best-effort read.
    expect(() => parseCreateQuote({ ...quote, paymentUsdc: 50 })).toThrow(
      CreateClientError,
    );
    expect(() => parseCreateQuote({ ...quote, expiresAt: 'soon' })).toThrow(
      CreateClientError,
    );
    expect(() => parseCreateQuote({ ...quote, expectedEventPda: 'not-a-pda' })).toThrow(
      CreateClientError,
    );
    expect(() => parseCreateQuote(null)).toThrow(CreateClientError);
  });
});

describe('parseCreateBuild', () => {
  it('accepts the route payload and returns the domain build', () => {
    expect(parseCreateBuild(build)).toEqual(build);
  });

  it('refuses a build with no signable transaction', () => {
    // The empty-transaction sandbox shape must never reach the signer.
    expect(() => parseCreateBuild({ ...build, transaction: '' })).toThrow(
      CreateClientError,
    );
    expect(() => parseCreateBuild({ ...build, buildExpiresAt: -1 })).toThrow(
      CreateClientError,
    );
  });
});

describe('parseSourceVerdict', () => {
  it('passes through a confirmed verifier verdict', () => {
    expect(parseSourceVerdict({ ok: true, confidence: 'confirmed' })).toEqual({
      ok: true,
      confidence: 'confirmed',
    });
    expect(
      parseSourceVerdict({ ok: false, reason: 'source could not be reached' }),
    ).toEqual({
      ok: false,
      reason: 'source could not be reached',
    });
  });

  it('keeps an unconfirmed verdict unconfirmed, with fixed copy', () => {
    // Phase 3: a bot-blocked host is a pass, but it must never be upgraded to
    // "confirmed" on its way through the client.
    expect(
      parseSourceVerdict({
        ok: true,
        confidence: 'unconfirmed',
        reason: 'source responded with HTTP 403 — the site refuses automated checks',
      }),
    ).toEqual({
      ok: true,
      confidence: 'unconfirmed',
      reason: 'source responded with HTTP 403 — the site refuses automated checks',
    });
    expect(parseSourceVerdict({ ok: true, confidence: 'unconfirmed' })).toEqual({
      ok: true,
      confidence: 'unconfirmed',
      reason: 'the site refuses automated checks, so this page could not be read',
    });
  });

  it('fails closed on an unreadable verdict', () => {
    // Phase 2: an unreadable answer is a FAILED check — never an implicit pass.
    expect(parseSourceVerdict({ ok: 'yes' })).toEqual({
      ok: false,
      reason: 'The source check returned an unreadable result.',
    });
    expect(parseSourceVerdict(undefined)).toEqual({
      ok: false,
      reason: 'The source check returned an unreadable result.',
    });
    // An `ok` verdict with NO tier is refused rather than assumed confirmed:
    // assuming would silently skip the attestation the user is meant to give.
    expect(parseSourceVerdict({ ok: true })).toEqual({
      ok: false,
      reason: 'The source check returned an unreadable result.',
    });
    expect(parseSourceVerdict({ ok: true, confidence: 'maybe' })).toEqual({
      ok: false,
      reason: 'The source check returned an unreadable result.',
    });
    // A hostile route must not be able to push an unbounded string into the UI.
    expect(
      parseSourceVerdict({ ok: false, reason: 'x'.repeat(301) }),
    ).toEqual({
      ok: false,
      reason: 'The source check returned an unreadable result.',
    });
  });
});

describe('describeSourceCheckError', () => {
  it('names the failure per status and never echoes an upstream string', () => {
    const statuses = [0, 400, 401, 403, 404, 429, 500, 502, 503, 504];
    for (const status of statuses) {
      const message = describeSourceCheckError(status);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(String(status));
    }
    // The distinction that was previously invisible: a missing route in dev.
    expect(describeSourceCheckError(404)).toBe(
      'Source checking is not available right now.',
    );
    expect(describeSourceCheckError(0)).toBe(
      'Source checking could not be reached.',
    );
    expect(describeSourceCheckError(401)).toBe(
      'Sign in again to check sources.',
    );
  });
});

describe('describeCreateClientError', () => {
  it('returns fixed copy per status and never an upstream string', () => {
    const statuses = [0, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504];
    for (const status of statuses) {
      const message = describeCreateClientError(status);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(String(status));
    }
    expect(describeCreateClientError(401)).toBe('Sign in to continue.');
    expect(describeCreateClientError(0)).toBe(
      'The create request could not be completed.',
    );
  });
});
