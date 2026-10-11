/**
 * ledger/db — Postgres-backed ledger storage.
 *
 * Owns: schema + row mapping to/from `types/ledger.LedgerRow`, state
 * transitions (guarded by `canTransition`), and aggregate stats via SQL.
 * Must not import: adapters, network, React, Next.
 *
 * Money: store both base-unit BIGINT (for fast sums) and the decimal string
 * (to round-trip the exact domain value). `LedgerRow.amountUsdc` is the
 * decimal string per types/ledger.ts.
 */
import { sql } from '@vercel/postgres';
import {
  aggregateStats,
  canTransition,
  type LedgerRow,
  type LedgerStatus,
  type VolumeClass,
} from '@/types/ledger';
import { baseUnitsFromJson, baseUnitsJsonSchema, baseUnitsToJson, baseUnitsToUsdcDecimal, usdcDecimalToBaseUnits } from '@/types/money';
import { unixSeconds, type UnixSeconds } from '@/types/time';
import { txSignatureSchema } from '@/types/ids';

export type LedgerDbError =
  | { readonly kind: 'invalid_transition'; readonly from: LedgerStatus; readonly to: LedgerStatus }
  | { readonly kind: 'not_found'; readonly signature: string }
  | { readonly kind: 'db'; readonly message: string };

function mapError(e: unknown): LedgerDbError {
  return { kind: 'db', message: e instanceof Error ? e.message : 'database error' };
}

interface DbLedgerRow {
  signature: string;
  wallet: string;
  market_id: string;
  side: 'YES' | 'NO';
  amount_usdc_base: bigint;
  amount_usdc_dec: string;
  source_app: string;
  source_surface: string;
  order_id: string;
  quote_id: string;
  status: LedgerStatus;
  volume_class: VolumeClass;
  created_at: bigint;
  updated_at: bigint;
  report_attempts: number;
  last_error: unknown | null;
}

function toDomain(row: DbLedgerRow): LedgerRow {
  return {
    signature: txSignatureSchema.parse(row.signature),
    wallet: row.wallet,
    marketId: row.market_id,
    side: row.side,
    amountUsdc: row.amount_usdc_dec,
    source: { app: row.source_app, surface: row.source_surface },
    orderId: row.order_id,
    quoteId: row.quote_id,
    status: row.status,
    volumeClass: row.volume_class,
    createdAt: unixSeconds(Number(row.created_at)),
    updatedAt: unixSeconds(Number(row.updated_at)),
    reportAttempts: row.report_attempts,
    lastError: row.last_error as any,
  };
}

export async function ensureLedgerSchema(): Promise<void> {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS ledger (
        signature TEXT PRIMARY KEY,
        wallet TEXT NOT NULL,
        market_id TEXT NOT NULL,
        side TEXT NOT NULL CHECK (side IN ('YES','NO')),
        amount_usdc_base BIGINT NOT NULL,
        amount_usdc_dec TEXT NOT NULL,
        source_app TEXT NOT NULL,
        source_surface TEXT NOT NULL,
        order_id TEXT NOT NULL,
        quote_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('built','submitted','reported','pending_report','failed')),
        volume_class TEXT NOT NULL CHECK (volume_class IN ('test','user')),
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        report_attempts INT NOT NULL DEFAULT 0,
        last_error JSONB
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS ledger_wallet_idx ON ledger(wallet);`;
    await sql`CREATE INDEX IF NOT EXISTS ledger_market_idx ON ledger(market_id);`;
    await sql`CREATE INDEX IF NOT EXISTS ledger_status_idx ON ledger(status);`;
    await sql`CREATE INDEX IF NOT EXISTS ledger_created_at_idx ON ledger(created_at);`;
  } catch (e) {
    throw mapError(e);
  }
}

/** Insert a row in 'built' status. Idempotent by signature (do nothing if exists). */
export async function insertBuilt(row: LedgerRow): Promise<void> {
  const base = usdcDecimalToBaseUnits(row.amountUsdc);
  const baseJson = baseUnitsToJson(base);
  const baseBig = BigInt(baseJson);
  try {
    await sql`
      INSERT INTO ledger (
        signature, wallet, market_id, side, amount_usdc_base, amount_usdc_dec,
        source_app, source_surface, order_id, quote_id, status, volume_class,
        created_at, updated_at, report_attempts, last_error
      ) VALUES (
        ${row.signature}, ${row.wallet}, ${row.marketId}, ${row.side}, ${baseBig}, ${row.amountUsdc},
        ${row.source.app}, ${row.source.surface}, ${row.orderId}, ${row.quoteId}, ${row.status},
        ${row.volumeClass}, ${Number(row.createdAt)}, ${Number(row.updatedAt)}, ${row.reportAttempts},
        ${row.lastError ? JSON.stringify(row.lastError) : null}
      )
      ON CONFLICT (signature) DO NOTHING;
    `;
  } catch (e) {
    throw mapError(e);
  }
}

/** Transition a row to `to` if legal. Returns the updated row or not_found/invalid_transition. */
export async function transition(
  signature: string,
  to: LedgerStatus,
  patch?: Partial<{ reportAttempts: number; lastError: any; updatedAt: UnixSeconds }>,
): Promise<LedgerRow> {
  const sig = txSignatureSchema.parse(signature);
  try {
    const r = await sql<DbLedgerRow>`SELECT * FROM ledger WHERE signature=${sig}`;
    if (r.rows.length === 0) return (undefined as any) as never;
  } catch (e) {
    throw mapError(e);
  }
  // fetch current
  const cur = await sql<DbLedgerRow>`SELECT * FROM ledger WHERE signature=${sig}`;
  if (cur.rows.length === 0) throw { kind: 'not_found', signature: sig } as LedgerDbError;
  const current = cur.rows[0]!;
  if (!canTransition(current.status as LedgerStatus, to)) {
    throw { kind: 'invalid_transition', from: current.status as LedgerStatus, to } as LedgerDbError;
  }
  const now = patch?.updatedAt ?? unixSeconds(Math.floor(Date.now() / 1000));
  const attempts = patch?.reportAttempts ?? current.report_attempts;
  const errJson = patch?.lastError ? JSON.stringify(patch.lastError) : current.last_error;
  const res = await sql<DbLedgerRow>`
    UPDATE ledger
    SET status=${to}, updated_at=${Number(now)}, report_attempts=${attempts}, last_error=${errJson}
    WHERE signature=${sig}
    RETURNING *;
  `;
  if (res.rows.length === 0) throw { kind: 'not_found', signature: sig } as LedgerDbError;
  return toDomain(res.rows[0]!);
}
