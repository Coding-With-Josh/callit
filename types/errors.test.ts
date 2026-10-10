import { describe, it, expect } from 'vitest';
import {
  KNOWN_PANTA_ERROR_CODES,
  RETRYABLE_PANTA_ERROR_CODES,
  USER_FIXABLE_PANTA_ERROR_CODES,
  TERMINAL_PANTA_ERROR_CODES,
  parsePantaError,
  classifyPantaError,
  isRetryable,
  fieldErrors,
} from './errors';

describe('panta errors', () => {
  it('parses a known code and classifies it retryable', () => {
    const error = parsePantaError({ code: 'QUOTE_EXPIRED', message: 'expired' });
    expect(error.kind).toBe('known');
    expect(classifyPantaError(error)).toBe('retryable');
    expect(isRetryable(error)).toBe(true);
  });

  it('preserves an unknown code and fails closed to terminal', () => {
    const error = parsePantaError({ code: 'SOMETHING_NEW', message: 'nope' });
    expect(error.kind).toBe('unknown');
    if (error.kind === 'unknown') expect(error.rawCode).toBe('SOMETHING_NEW');
    expect(classifyPantaError(error)).toBe('terminal');
    expect(isRetryable(error)).toBe(false);
  });

  it('classifies validation and duplicate-market errors as user-fixable', () => {
    expect(
      classifyPantaError(
        parsePantaError({ code: 'INVALID_MARKET_PARAMS', message: 'x' }),
      ),
    ).toBe('user-fixable');
    expect(
      classifyPantaError(
        parsePantaError({ code: 'DUPLICATE_MARKET', message: 'x' }),
      ),
    ).toBe('user-fixable');
  });

  it('classifies a transaction mismatch as terminal', () => {
    expect(
      classifyPantaError(parsePantaError({ code: 'TX_MISMATCH', message: 'x' })),
    ).toBe('terminal');
    // A failed on-chain tx must NOT be auto-retried.
    expect(
      classifyPantaError(parsePantaError({ code: 'TX_FAILED', message: 'x' })),
    ).toBe('terminal');
  });

  it('carries the single field, field errors and retry-after through', () => {
    const error = parsePantaError(
      {
        code: 'INVALID_MARKET_PARAMS',
        message: 'bad',
        field: 'startTime',
        fields: { question: ['too long'] },
      },
      400,
      30,
    );
    expect(error.field).toBe('startTime');
    expect(fieldErrors(error).question).toEqual(['too long']);
    expect(error.status).toBe(400);
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('classifies every known code, exactly once (partition)', () => {
    const all = [
      ...RETRYABLE_PANTA_ERROR_CODES,
      ...USER_FIXABLE_PANTA_ERROR_CODES,
      ...TERMINAL_PANTA_ERROR_CODES,
    ];
    // No duplicates -> the three classes are disjoint.
    expect(new Set(all).size).toBe(all.length);
    // Nothing missing -> every known code is classified.
    expect(new Set(all)).toEqual(new Set(KNOWN_PANTA_ERROR_CODES));
    // And every known code yields one of the three classes.
    for (const code of KNOWN_PANTA_ERROR_CODES) {
      const klass = classifyPantaError(parsePantaError({ code, message: 'x' }));
      expect(['retryable', 'terminal', 'user-fixable']).toContain(klass);
    }
  });
});
