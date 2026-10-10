import { describe, it, expect } from 'vitest';
import {
  serializeAttribution,
  parseAttribution,
  USER_ID_MAX_LENGTH,
} from './attribution';

describe('attribution codec', () => {
  it('round-trips app + surface', () => {
    const serialized = serializeAttribution({ app: 'web', surface: 'web' });
    if (!serialized.ok) throw new Error('expected ok');
    expect(serialized.value).toBe('callit:v1:web:web');

    const parsed = parseAttribution(serialized.value);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.value).toEqual({ app: 'web', surface: 'web' });
    expect(parsed.value.campaign).toBeUndefined();
  });

  it('round-trips a campaign', () => {
    const serialized = serializeAttribution({
      app: 'blink',
      surface: 'blink',
      campaign: 'launch',
    });
    if (!serialized.ok) throw new Error('expected ok');
    const parsed = parseAttribution(serialized.value);
    if (!parsed.ok) throw new Error('expected ok');
    expect(parsed.value).toEqual({ app: 'blink', surface: 'blink', campaign: 'launch' });
  });

  it('rejects an unknown app', () => {
    const parsed = parseAttribution('callit:v1:not-an-app:web');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe('unknown-app');
  });

  it('rejects a malformed tag', () => {
    const parsed = parseAttribution('garbage');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe('malformed');
  });

  it('rejects an over-long userId', () => {
    const campaign = 'x'.repeat(USER_ID_MAX_LENGTH);
    const serialized = serializeAttribution({ app: 'web', surface: 'web', campaign });
    expect(serialized.ok).toBe(false);
    if (!serialized.ok) expect(serialized.error.kind).toBe('too-long');
  });

  it('rejects a bad-charset campaign', () => {
    const serialized = serializeAttribution({ app: 'web', surface: 'web', campaign: 'bad!chars' });
    expect(serialized.ok).toBe(false);
    if (!serialized.ok) expect(serialized.error.kind).toBe('bad-charset');
  });
});
