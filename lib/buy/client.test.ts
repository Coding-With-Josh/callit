/**
 * buy/client unit tests — parsing, order verification and assembly.
 *
 * These cover the client boundary that stands between a network response and
 * the wallet: a response that is malformed, carries unknown keys, or answers a
 * different order than the one requested must fail closed here (Phase 3:
 * parameter substitution / confused upstream).
 */
import { describe, expect, it } from 'vitest';
import { getBase64Decoder } from '@solana/kit';
import { usdcDecimalSchema, walletAddressSchema, type UsdcDecimal } from '@/types';
import {
  assembleBuyOrder,
  describeAssembleError,
  describeBuyClientError,
  parseBuiltOrder,
  parseBuyQuote,
  verifyBuyOrder,
} from './client';
import { decodeUnsignedTransactionB64, getSingleRequiredSigner } from '@/lib/solana/sign';

const PAYER = walletAddressSchema.parse('3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F');
const OTHER = '8zQRDCnpnpjStPzHb9vz4xTqbvB7vgg5hK41yPY2euif';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const BLOCKHASH = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';

/** Base64 of the 12-byte System `Transfer` instruction (1 lamport). */
const DATA_B64 = getBase64Decoder().decode(
  new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
);

const QUOTE_WIRE = {
  quoteId: 'quote-1',
  marketId: 'market-1',
  side: 'yes',
  shares: '12.5',
  avgPrice: '0.62',
  feeUsdc: '0.75',
  expiresAt: 1_800_000_000,
};

function orderWire(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'order-1',
    quoteId: 'quote-1',
    marketId: 'market-1',
    side: 'yes',
    wallet: PAYER,
    amountUsdc: '25',
    instructions: [
      {
        programId: SYSTEM_PROGRAM,
        data: DATA_B64,
        accounts: [
          { pubkey: PAYER, isSigner: true, isWritable: true },
          { pubkey: PAYER, isSigner: false, isWritable: false },
        ],
      },
    ],
    recentBlockhash: BLOCKHASH,
    lastValidBlockHeight: 123,
    derived: {},
    expectedShares: '12.5',
    feeUsdc: '0.75',
    buildExpiresAt: 1_800_000_600,
    ...overrides,
  };
}

/** A parsed fixture quote (throws if the fixture is itself malformed). */
function quote() {
  const parsed = parseBuyQuote(QUOTE_WIRE);
  if (!parsed.ok) throw new Error('fixture quote failed to parse');
  return parsed.value;
}

/** A parsed fixture order (throws if the fixture is itself malformed). */
function order(overrides: Record<string, unknown> = {}) {
  const parsed = parseBuiltOrder(orderWire(overrides));
  if (!parsed.ok) throw new Error('fixture order failed to parse');
  return parsed.value;
}

function amount(value: string): UsdcDecimal {
  return usdcDecimalSchema.parse(value);
}

describe('parseBuyQuote', () => {
  it('accepts a well-formed quote', () => {
    expect(parseBuyQuote(QUOTE_WIRE).ok).toBe(true);
  });

  it('rejects an unknown property (allow-list fields only)', () => {
    const parsed = parseBuyQuote({ ...QUOTE_WIRE, smuggled: 'x' });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe('malformed-quote');
  });

  it('rejects a non-enum side', () => {
    expect(parseBuyQuote({ ...QUOTE_WIRE, side: 'YES' }).ok).toBe(false);
  });

  it('rejects a missing field', () => {
    const partial = {
      quoteId: 'quote-1',
      marketId: 'market-1',
      side: 'yes',
      shares: '12.5',
      avgPrice: '0.62',
      expiresAt: 1_800_000_000,
    };
    expect(parseBuyQuote(partial).ok).toBe(false);
  });
});

describe('parseBuiltOrder', () => {
  it('accepts a well-formed order', () => {
    expect(parseBuiltOrder(orderWire()).ok).toBe(true);
  });

  it('rejects an empty instruction list (nothing to sign)', () => {
    expect(parseBuiltOrder(orderWire({ instructions: [] })).ok).toBe(false);
  });

  it('rejects an unsafe derived key (prototype pollution)', () => {
    const parsed = parseBuiltOrder(orderWire({ derived: { ['__proto__']: 'x' } }));
    expect(parsed.ok).toBe(false);
  });
});

describe('verifyBuyOrder', () => {
  const request = (overrides: Partial<Parameters<typeof verifyBuyOrder>[2]> = {}) => ({
    marketId: quote().marketId,
    side: 'yes' as const,
    amountUsdc: amount('25'),
    wallet: PAYER,
    ...overrides,
  });

  it('accepts an order that matches the request and the quote', () => {
    expect(verifyBuyOrder(quote(), order(), request()).ok).toBe(true);
  });

  it('accepts an amount that differs only in decimal representation', () => {
    expect(verifyBuyOrder(quote(), order(), request({ amountUsdc: amount('25.00') })).ok).toBe(true);
  });

  it('rejects a different quote', () => {
    const verified = verifyBuyOrder(quote(), order({ quoteId: 'quote-2' }), request());
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error).toEqual({ kind: 'order-mismatch', field: 'quoteId' });
  });

  it('rejects a substituted market, side, wallet or amount', () => {
    expect(verifyBuyOrder(quote(), order({ marketId: 'market-2' }), request()).ok).toBe(false);
    expect(verifyBuyOrder(quote(), order({ side: 'no' }), request()).ok).toBe(false);
    expect(verifyBuyOrder(quote(), order({ wallet: OTHER }), request()).ok).toBe(false);
    expect(verifyBuyOrder(quote(), order(), request({ amountUsdc: amount('250') })).ok).toBe(false);
  });
});

describe('assembleBuyOrder', () => {
  it('compiles to bytes whose only required signer is the fee payer', () => {
    const assembled = assembleBuyOrder(order(), PAYER);
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;
    expect(getSingleRequiredSigner(decodeUnsignedTransactionB64(assembled.value))).toBe(PAYER);
  });

  it('fails closed on a malformed blockhash', () => {
    const assembled = assembleBuyOrder(order({ recentBlockhash: 'zzz' }), PAYER);
    expect(assembled.ok).toBe(false);
    if (!assembled.ok) expect(assembled.error.kind).toBe('invalid-blockhash');
  });
});

describe('describeAssembleError / describeBuyClientError', () => {
  it('returns fixed non-empty copy for every kind', () => {
    expect(describeAssembleError({ kind: 'empty-instructions' }).length).toBeGreaterThan(0);
    expect(
      describeAssembleError({ kind: 'unexpected-signers', signers: [] }).length,
    ).toBeGreaterThan(0);
    expect(
      describeAssembleError({ kind: 'signer-mismatch', message: 'x' }).length,
    ).toBeGreaterThan(0);
    expect(describeAssembleError({ kind: 'encode-failed', message: 'x' }).length).toBeGreaterThan(0);
    expect(describeBuyClientError({ kind: 'malformed-quote' }).length).toBeGreaterThan(0);
    expect(describeBuyClientError({ kind: 'order-mismatch', field: 'side' }).length).toBeGreaterThan(0);
  });
});
