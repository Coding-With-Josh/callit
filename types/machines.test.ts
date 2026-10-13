import { describe, it, expect } from 'vitest';
import {
  marketIdSchema,
  quoteIdSchema,
  orderIdSchema,
  txSignatureSchema,
  walletAddressSchema,
} from './ids';
import { usdcDecimalSchema, sharesSchema, priceSchema } from './money';
import { unixSecondsSchema } from './time';
import {
  requirePrimaryMarket,
  type PrimaryMarket,
  type SecondaryMarket,
} from './market';
import { startBuyQuote, canBuyTransition, type BuyQuote } from './buy';
import { canCreateTransition } from './create';
import { canTransition, aggregateStats, type LedgerRow } from './ledger';
import { signerCheck } from './tx';
import type { RawInstruction } from './panta-wire/common';
import { deriveMarketRoles } from './position';

const mid = marketIdSchema.parse('m1');
const walletA = walletAddressSchema.parse('11111111111111111111111111111111');
const walletB = walletAddressSchema.parse('So11111111111111111111111111111111111111112');

const baseMarket = {
  marketId: mid,
  category: 'weather',
  title: 't',
  description: 'd',
  volumeUsdc: usdcDecimalSchema.parse('0'),
  startTime: unixSecondsSchema.parse(0),
  endTime: unixSecondsSchema.parse(10),
  resolutionTime: unixSecondsSchema.parse(20),
  resolved: false,
  yesPrice: null,
  noPrice: null,
};

const primary: PrimaryMarket = {
  ...baseMarket,
  phase: 'primary',
  resolved: false,
};
const secondary: SecondaryMarket = { ...baseMarket, phase: 'secondary' };

const quote: BuyQuote = {
  quoteId: quoteIdSchema.parse('q1'),
  marketId: mid,
  side: 'yes',
  shares: sharesSchema.parse('1'),
  avgPrice: priceSchema.parse('0.5'),
  feeUsdc: usdcDecimalSchema.parse('0.01'),
  expiresAt: unixSecondsSchema.parse(100),
};

describe('market phase guard', () => {
  it('accepts a primary market', () => {
    expect(requirePrimaryMarket(primary).ok).toBe(true);
  });

  it('returns a link-out for a non-primary market', () => {
    const result = requirePrimaryMarket(secondary);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('link-out');
      expect(result.error.phase).toBe('secondary');
    }
  });
});

describe('buy lifecycle', () => {
  it('only starts from a primary market and rejects a market mismatch', () => {
    expect(startBuyQuote(primary, quote).ok).toBe(true);
    const other = { ...quote, marketId: marketIdSchema.parse('m2') };
    const mismatched = startBuyQuote(primary, other);
    expect(mismatched.ok).toBe(false);
    if (!mismatched.ok) expect(mismatched.error.kind).toBe('market-mismatch');
  });

  it('allows only legal transitions', () => {
    expect(canBuyTransition('quoted', 'built')).toBe(true);
    expect(canBuyTransition('submitted', 'reported')).toBe(true);
    expect(canBuyTransition('quoted', 'reported')).toBe(false);
    expect(canBuyTransition('reported', 'quoted')).toBe(false);
  });
});

describe('create + ledger transitions', () => {
  it('gates create transitions', () => {
    expect(canCreateTransition('quoted', 'built')).toBe(true);
    expect(canCreateTransition('drafted', 'quoted')).toBe(false);
    expect(canCreateTransition('registered', 'quoted')).toBe(false);
  });

  it('gates ledger transitions', () => {
    expect(canTransition('built', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'reported')).toBe(true);
    expect(canTransition('reported', 'submitted')).toBe(false);
  });
});

describe('ledger aggregation', () => {
  it('sums with bigint math and splits user/test/by-source', () => {
    const signature = txSignatureSchema.parse('1'.repeat(64));
    const rowA: LedgerRow = {
      signature,
      wallet: walletA,
      marketId: mid,
      side: 'yes',
      amountUsdc: usdcDecimalSchema.parse('1'),
      source: { app: 'web', surface: 'web' },
      orderId: orderIdSchema.parse('o1'),
      quoteId: quoteIdSchema.parse('q1'),
      status: 'submitted',
      volumeClass: 'user',
      createdAt: unixSecondsSchema.parse(0),
      updatedAt: unixSecondsSchema.parse(1),
      reportAttempts: 0,
    };
    const rowB: LedgerRow = {
      ...rowA,
      wallet: walletB,
      amountUsdc: usdcDecimalSchema.parse('2.5'),
      source: { app: 'blink', surface: 'blink' },
      orderId: orderIdSchema.parse('o2'),
      volumeClass: 'test',
    };

    const stats = aggregateStats([rowA, rowB]);
    expect(stats.totalVolumeUsdc).toBe('3.5');
    expect(stats.userVolumeUsdc).toBe('1');
    expect(stats.testVolumeUsdc).toBe('2.5');
    expect(stats.distinctWallets).toBe(2);
    expect(stats.bySource['web:web']).toBe('1');
    expect(stats.bySource['blink:blink']).toBe('2.5');
  });
});

describe('tx signer check', () => {
  it('reports when a signer other than the user is required', () => {
    const onlyUser: RawInstruction[] = [
      {
        programId: 'p',
        data: '',
        accounts: [{ pubkey: walletA, isSigner: true, isWritable: true }],
      },
    ];
    expect(signerCheck(onlyUser, walletA).onlyUserSigns).toBe(true);

    const withExtra: RawInstruction[] = [
      ...onlyUser,
      {
        programId: 'p2',
        data: '',
        accounts: [{ pubkey: walletB, isSigner: true, isWritable: false }],
      },
    ];
    const check = signerCheck(withExtra, walletA);
    expect(check.onlyUserSigns).toBe(false);
    expect(check.unexpectedSigners).toEqual([walletB]);
  });
});

describe('derived roles', () => {
  it('derives creator and holder roles without stored user types', () => {
    expect(deriveMarketRoles({ createdByMe: true, position: null, creatorFeesClaimable: false })).toEqual([
      'created-by',
    ]);
    expect(deriveMarketRoles({ createdByMe: false, position: null, creatorFeesClaimable: false })).toEqual([]);
  });
});
