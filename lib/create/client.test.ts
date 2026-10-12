import { describe, it, expect } from 'vitest';
import {
  CreateClientError,
  describeCreateClientError,
  describeRegisterClientError,
  describeSourceCheckError,
  parseCreateBuild,
  parseCreateQuote,
  parseCreateRegister,
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

describe('parseCreateRegister', () => {
  it('accepts the route payload and returns the market id', () => {
    expect(parseCreateRegister({ marketId: 'mkt_reg_1' })).toBe('mkt_reg_1');
  });

  it('refuses a success that carries no usable market id', () => {
    // Phase 2 (no fabricated success): register is the money step, so the UI may
    // only announce a market when a plausible id came back. Every one of these
    // shapes must fail rather than settle for "it probably worked".
    expect(() => parseCreateRegister({})).toThrow(CreateClientError);
    expect(() => parseCreateRegister({ marketId: '' })).toThrow(CreateClientError);
    expect(() => parseCreateRegister({ marketId: 42 })).toThrow(CreateClientError);
    expect(() => parseCreateRegister({ marketId: null })).toThrow(CreateClientError);
    expect(() => parseCreateRegister(null)).toThrow(CreateClientError);
    expect(() => parseCreateRegister('mkt_reg_1')).toThrow(CreateClientError);
    // An id longer than the schema allows is refused, not truncated.
    expect(() => parseCreateRegister({ marketId: 'x'.repeat(129) })).toThrow(
      CreateClientError,
    );
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
      'Connect your wallet to check sources.',
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
    // 502 is an upstream Panta failure, including Panta rejecting our own
    // credentials — it must never render as "sign in".
    expect(describeCreateClientError(502)).not.toBe('Sign in to continue.');
    expect(describeCreateClientError(502)).toContain('unavailable');
  });
});

describe('describeRegisterClientError', () => {
  it('returns fixed copy per status and never echoes an upstream string', () => {
    const statuses = [0, 400, 401, 403, 404, 409, 410, 422, 429, 500, 502, 503, 504];
    for (const status of statuses) {
      const message = describeRegisterClientError(status);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(String(status));
    }
  });

  it('does not reuse the create copy that would blame the draft', () => {
    // The bug this copy exists to prevent: register forwards a 400 and the user
    // is told to go and edit a claim that is not the problem — at a stage where
    // the transaction is already signed and the draft cannot be changed.
    expect(describeRegisterClientError(400)).not.toBe(
      describeCreateClientError(400),
    );
    expect(describeRegisterClientError(400)).not.toContain('draft');
  });

  it('never claims nothing was charged when that is UNKNOWN', () => {
    // The invariant that matters most on a money path. For a timeout, an
    // upstream failure, or a session that was "not found OR already consumed",
    // the submission may have succeeded and the fee may have moved. The copy
    // must send the user to their own record instead of reassuring them.
    for (const status of [0, 502, 503, 504, 409]) {
      const message = describeRegisterClientError(status);
      expect(message).toMatch(/check your markets/i);
      // No reassurance about money for a genuinely ambiguous outcome.
      expect(message).not.toMatch(/nothing was charged|no money|not charged/i);
    }
  });

  it('distinguishes "gone" (410) from "already used" (409) instead of blurring them', () => {
    // The two failures look similar and mean opposite things. 409 = the session
    // is finished and a charge may have happened, so it must send the user to
    // their own record. 410 = Panta holds no transaction, so nothing can have
    // been charged — but the signature is spent and only a rebuild can help.
    const gone = describeRegisterClientError(410);
    const used = describeRegisterClientError(409);
    expect(gone).toContain('nothing was submitted');
    expect(gone).toMatch(/build it again/i);
    expect(gone).not.toMatch(/check your markets/i);
    expect(gone).not.toBe(used);
  });

  it('does state plainly when nothing was submitted', () => {
    // A 400 is a refusal BEFORE submission (our perimeter, or Panta refusing the
    // submission), and a failed submit does not consume the create session — so
    // a retry is safe and the copy may say so.
    expect(describeRegisterClientError(400)).toContain('nothing was submitted');
  });

  it('never renders a register failure as "sign in"', () => {
    // 502 is our wrapper around an upstream fault, including Panta rejecting OUR
    // key. It is a server-side integration fact and no user action fixes it.
    for (const status of [500, 502, 503, 504, 409, 400]) {
      expect(describeRegisterClientError(status)).not.toBe('Sign in to continue.');
    }
    expect(describeRegisterClientError(401)).toBe('Sign in to continue.');
  });
});
