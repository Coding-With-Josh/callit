import { describe, it, expect } from 'vitest';
import {
  describeSessionMintFailure,
  type SessionMintFailureKind,
} from './session-mint';

const ALL_KINDS: readonly SessionMintFailureKind[] = [
  'no-wallet',
  'unavailable',
  'unauthorized',
  'network',
];

describe('describeSessionMintFailure', () => {
  it('gives every failure kind a non-empty, distinct message', () => {
    const messages = ALL_KINDS.map((kind) => describeSessionMintFailure(kind));
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
    }
    // Distinct: a single catch-all sentence is exactly what hid the real cause
    // (a mint that failed for its own reason read as "you are signed out").
    expect(new Set(messages).size).toBe(ALL_KINDS.length);
  });

  it('never claims the user is signed out — that is the false statement this fixes', () => {
    for (const kind of ALL_KINDS) {
      const message = describeSessionMintFailure(kind);
      expect(message.toLowerCase()).not.toContain('sign in');
      expect(message.toLowerCase()).not.toContain('sign out');
    }
  });

  it('points at reconnecting only when the wallet link is the problem', () => {
    // `no-wallet` is the one kind the user can act on directly.
    expect(describeSessionMintFailure('no-wallet').toLowerCase()).toContain('reconnect');
    // A provider outage is not the user's fault.
    expect(describeSessionMintFailure('unavailable').toLowerCase()).not.toContain('reconnect');
    expect(describeSessionMintFailure('unavailable').toLowerCase()).toContain('unavailable');
  });
});
