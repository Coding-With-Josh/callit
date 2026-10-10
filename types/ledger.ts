/**
 * ledger — per-channel ledger rows, transitions, stats and reconciliation.
 *
 * Owns: the LedgerRow type, its legal status transitions, derived stats for the
 * public stats page, and the reconciliation result against Panta metrics.
 * Must not import: adapters, network, or any framework. Pure aggregation only.
 *
 * Base units are never stored as bigint in JSON: rows carry `amountUsdc` as a
 * decimal USDC string, and the codec in `money` handles bigint conversion.
 */
import { z } from 'zod';
import {
  baseUnitsToUsdcDecimal,
  usdcDecimalToBaseUnits,
  type UsdcBaseUnits,
  type UsdcDecimal,
} from './money';
import type { MarketId, OrderId, QuoteId, TxSignature, WalletAddress } from './ids';
import type { UnixSeconds } from './time';
import type { Side } from './market';
import type { Attribution } from './attribution';
import type { PantaError } from './errors';

/** Ledger row statuses. */
export const LEDGER_STATUSES = [
  'built',
  'submitted',
  'reported',
  'pending_report',
  'failed',
] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/** Whether a row counts as test or real user volume. */
export const ledgerVolumeClassSchema = z.enum(['test', 'user']);
export type VolumeClass = z.infer<typeof ledgerVolumeClassSchema>;

/** One row in our attributed ledger. */
export interface LedgerRow {
  readonly signature: TxSignature;
  readonly wallet: WalletAddress;
  readonly marketId: MarketId;
  readonly side: Side;
  readonly amountUsdc: UsdcDecimal;
  readonly source: Attribution;
  readonly orderId: OrderId;
  readonly quoteId: QuoteId;
  readonly status: LedgerStatus;
  readonly volumeClass: VolumeClass;
  readonly createdAt: UnixSeconds;
  readonly updatedAt: UnixSeconds;
  readonly reportAttempts: number;
  readonly lastError?: PantaError;
}

/** Legal row transitions. */
export const LEDGER_TRANSITIONS: Readonly<Record<LedgerStatus, readonly LedgerStatus[]>> = {
  built: ['submitted', 'failed'],
  submitted: ['reported', 'pending_report', 'failed'],
  pending_report: ['reported', 'failed'],
  reported: [],
  failed: ['submitted'],
};

/** True when `to` is a legal next status from `from`. */
export function canTransition(from: LedgerStatus, to: LedgerStatus): boolean {
  return LEDGER_TRANSITIONS[from].includes(to);
}

/** Derived stats for the public stats page. */
export interface LedgerStats {
  readonly totalVolumeUsdc: UsdcDecimal;
  readonly userVolumeUsdc: UsdcDecimal;
  readonly testVolumeUsdc: UsdcDecimal;
  readonly distinctWallets: number;
  readonly bySource: Readonly<Record<string, UsdcDecimal>>;
}

/** Pure: aggregate ledger rows into stats (bigint math; no floats). */
export function aggregateStats(rows: readonly LedgerRow[]): LedgerStats {
  let total = BigInt(0);
  let user = BigInt(0);
  let test = BigInt(0);
  const wallets = new Set<string>();
  const bySource = new Map<string, bigint>();

  for (const row of rows) {
    const units = usdcDecimalToBaseUnits(row.amountUsdc);
    total += units;
    if (row.volumeClass === 'user') {
      user += units;
    } else {
      test += units;
    }
    wallets.add(row.wallet);
    const key = `${row.source.app}:${row.source.surface}`;
    bySource.set(key, (bySource.get(key) ?? BigInt(0)) + units);
  }

  const bySourceDec: Record<string, UsdcDecimal> = {};
  for (const [key, value] of bySource) {
    // Sums of non-negative values are valid base units.
    bySourceDec[key] = baseUnitsToUsdcDecimal(value as UsdcBaseUnits);
  }

  return {
    // Non-negative sums of non-negative values are valid base units.
    totalVolumeUsdc: baseUnitsToUsdcDecimal(total as UsdcBaseUnits),
    userVolumeUsdc: baseUnitsToUsdcDecimal(user as UsdcBaseUnits),
    testVolumeUsdc: baseUnitsToUsdcDecimal(test as UsdcBaseUnits),
    distinctWallets: wallets.size,
    bySource: bySourceDec,
  };
}

/** Reconciliation of our ledger against Panta's attributed totals. */
export interface ReconciliationResult {
  readonly checkedAt: UnixSeconds;
  readonly ourTotalUsdc: UsdcDecimal;
  readonly pantaAttributedUsdc: UsdcDecimal;
  readonly deltaUsdc: UsdcDecimal;
  readonly unreportedSignatures: readonly TxSignature[];
  readonly matched: boolean;
}
