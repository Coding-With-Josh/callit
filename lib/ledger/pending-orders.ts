/**
 * ledger/pending-orders — our own record of an order we built but never saw a
 * signature for yet.
 *
 * Owns: the `pending_orders` table, its schema bootstrap, insert/get/transition.
 * Must not import: adapters, React, Next.
 *
 * Why this table has to exist (found during the Blink review): `lib/ledger/db.ts`
 * is keyed on the transaction `signature`, and a Blink POST returns a transaction
 * *before* any signature exists. The chained callback then carries only
 * `{account, signature}` — no market, no order. So without a row keyed on the
 * server-issued `orderId` there is nothing to correlate the callback against, and
 * no way to reconcile a callback that never fires. This is that row.
 *
 * Slice note: this slice WRITES these rows (so a built order is always on
 * record); the callback/reconciler that reads them is the next slice. The
 * partial unique index on `signature` is in place already so the slice-2
 * "one order per signature" guarantee is a constraint, not a convention.
 */
import {
  marketIdSchema,
  orderIdSchema,
  quoteIdSchema,
  unixSeconds,
  usdcDecimalSchema,
  walletAddressSchema,
  type AppId,
  type MarketId,
  type OrderId,
  type QuoteId,
  type Side,
  type SurfaceId,
  type UnixSeconds,
  type UsdcDecimal,
  type VolumeClass,
  type WalletAddress,
} from '@/types';
import { query } from './connection';

export const PENDING_ORDER_STATUSES = [
  'built',
  'confirmed',
  'expired',
  'failed',
] as const;
export type PendingOrderStatus = (typeof PENDING_ORDER_STATUSES)[number];

/** One order we assembled and returned to a wallet. */
export interface PendingOrderRecord {
  readonly orderId: OrderId;
  readonly quoteId: QuoteId;
  readonly marketId: MarketId;
  readonly side: Side;
  readonly wallet: WalletAddress;
  readonly amountUsdc: UsdcDecimal;
  readonly expectedShares: string;
  readonly feeUsdc: UsdcDecimal;
  readonly sourceApp: AppId;
  readonly sourceSurface: SurfaceId;
  readonly volumeClass: VolumeClass;
  readonly status: PendingOrderStatus;
  readonly signature: string | null;
  readonly createdAt: UnixSeconds;
  readonly buildExpiresAt: UnixSeconds;
}

interface PendingOrderRow {
  order_id: string;
  quote_id: string;
  market_id: string;
  side: string;
  wallet: string;
  amount_usdc_dec: string;
  expected_shares: string;
  fee_usdc_dec: string;
  source_app: string;
  source_surface: string;
  volume_class: string;
  status: string;
  signature: string | null;
  created_at: string | number;
  build_expires_at: string | number;
}

let schemaReady: Promise<void> | null = null;

/** Create the table once per process; reset on failure so it can retry. */
export async function ensurePendingOrdersSchema(): Promise<void> {
  if (schemaReady === null) {
    schemaReady = (async () => {
      await query(
        `CREATE TABLE IF NOT EXISTS pending_orders (
           order_id TEXT PRIMARY KEY,
           quote_id TEXT NOT NULL,
           market_id TEXT NOT NULL,
           side TEXT NOT NULL CHECK (side IN ('yes','no')),
           wallet TEXT NOT NULL,
           amount_usdc_dec TEXT NOT NULL,
           expected_shares TEXT NOT NULL,
           fee_usdc_dec TEXT NOT NULL,
           source_app TEXT NOT NULL,
           source_surface TEXT NOT NULL,
           volume_class TEXT NOT NULL CHECK (volume_class IN ('test','user')),
           status TEXT NOT NULL CHECK (status IN ('built','confirmed','expired','failed')),
           signature TEXT,
           created_at BIGINT NOT NULL,
           build_expires_at BIGINT NOT NULL
         )`,
        [],
      );
      await query(
        `CREATE INDEX IF NOT EXISTS pending_orders_wallet_idx ON pending_orders(wallet)`,
        [],
      );
      await query(
        `CREATE INDEX IF NOT EXISTS pending_orders_status_idx ON pending_orders(status)`,
        [],
      );
      // Phase 3 (callback replay across orders): one order may never share a
      // signature with another. Enforced by the database, not by application
      // convention — a partial index so many rows may still have NULL.
      await query(
        `CREATE UNIQUE INDEX IF NOT EXISTS pending_orders_signature_idx
           ON pending_orders(signature) WHERE signature IS NOT NULL`,
        [],
      );
    })().catch((error: unknown) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function toDomain(row: PendingOrderRow): PendingOrderRecord {
  return {
    orderId: orderIdSchema.parse(row.order_id),
    quoteId: quoteIdSchema.parse(row.quote_id),
    marketId: marketIdSchema.parse(row.market_id),
    side: row.side === 'yes' ? 'yes' : 'no',
    wallet: walletAddressSchema.parse(row.wallet),
    amountUsdc: usdcDecimalSchema.parse(row.amount_usdc_dec),
    expectedShares: row.expected_shares,
    feeUsdc: usdcDecimalSchema.parse(row.fee_usdc_dec),
    sourceApp: row.source_app as AppId,
    sourceSurface: row.source_surface as SurfaceId,
    volumeClass: row.volume_class === 'test' ? 'test' : 'user',
    status: row.status as PendingOrderStatus,
    signature: row.signature,
    createdAt: unixSeconds(Number(row.created_at)),
    buildExpiresAt: unixSeconds(Number(row.build_expires_at)),
  };
}

/**
 * Record a built order. Idempotent on `orderId` — a retried POST that Panta
 * answers with the same order id must not fail or double-record.
 */
export async function insertPendingOrder(record: PendingOrderRecord): Promise<void> {
  await ensurePendingOrdersSchema();
  await query(
    `INSERT INTO pending_orders (
       order_id, quote_id, market_id, side, wallet, amount_usdc_dec,
       expected_shares, fee_usdc_dec, source_app, source_surface, volume_class,
       status, signature, created_at, build_expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (order_id) DO NOTHING`,
    [
      record.orderId,
      record.quoteId,
      record.marketId,
      record.side,
      record.wallet,
      record.amountUsdc,
      record.expectedShares,
      record.feeUsdc,
      record.sourceApp,
      record.sourceSurface,
      record.volumeClass,
      record.status,
      record.signature,
      Number(record.createdAt),
      Number(record.buildExpiresAt),
    ],
  );
}

/** Look up one order by its server-issued id, or null when unknown. */
export async function getPendingOrder(
  orderId: string,
): Promise<PendingOrderRecord | null> {
  await ensurePendingOrdersSchema();
  const rows = await query<PendingOrderRow>(
    `SELECT * FROM pending_orders WHERE order_id = $1`,
    [orderId],
  );
  const row = rows[0];
  return row === undefined ? null : toDomain(row);
}

/**
 * Attach a signature and move the status, once. Used by the slice-2 callback and
 * reconciler; the unique index on `signature` makes a replay a no-op rather than
 * a second attribution.
 */
export async function recordSignature(
  orderId: string,
  signature: string,
  status: PendingOrderStatus,
): Promise<void> {
  await ensurePendingOrdersSchema();
  await query(
    `UPDATE pending_orders SET signature = $2, status = $3
       WHERE order_id = $1 AND signature IS NULL`,
    [orderId, signature, status],
  );
}
