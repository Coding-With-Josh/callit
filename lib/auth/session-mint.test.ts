import { describe, it, expect } from 'vitest';
import {
  describeSessionFailure,
  type SessionFailureKind,
} from './session-mint';

const ALL_KINDS: readonly SessionFailureKind[] = [
  'no-token',
  'rejected',
  'no-wallet',
  'unavailable',
  'network',
  'not-persisted',
];

describe('describeSessionFailure', () => {
  it('gives every failure kind a non-empty, distinct message', () => {
    const messages = ALL_KINDS.map((kind) => describeSessionFailure(kind));
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }
    // Distinct: a single catch-all sentence is exactly what hid the real cause
    // (a session that failed for its own reason read as "you are signed out").
    expect(new Set(messages).size).toBe(ALL_KINDS.length);
  });

  it('never claims the user is signed out — that is the false statement this fixes', () => {
    for (const kind of ALL_KINDS) {
      const message = describeSessionFailure(kind).toLowerCase();
      for (const falseClaim of [
        'signed out',
        'you are signed out',
        'sign in to continue',
        'please sign in',
        'logged out',
      ]) {
        expect(message).not.toContain(falseClaim);
      }
    }
  });

  it('points at reconnecting only when the wallet link is the problem', () => {
    // `no-wallet` is the one kind the user can act on directly.
    expect(describeSessionFailure('no-wallet').toLowerCase()).toContain('reconnect');
    // A provider outage is not the user's fault.
    expect(describeSessionFailure('unavailable').toLowerCase()).not.toContain('reconnect');
    expect(describeSessionFailure('unavailable').toLowerCase()).toContain('unavailable');
  });

  it('distinguishes a mint that never ran from one the server refused', () => {
    // The two worlds need different investigations, so they must not share copy.
    expect(describeSessionFailure('no-token')).not.toBe(describeSessionFailure('rejected'));
    expect(describeSessionFailure('rejected').toLowerCase()).toContain('refused');
  });

  it('has its own copy for a session that did not stick', () => {
    // The mint reported success and the request was still anonymous: neither a
    // mint failure nor "signed out".
    const message = describeSessionFailure('not-persisted').toLowerCase();
    expect(message).toContain('did not stick');
    expect(message).not.toContain('refused');
  });
});
