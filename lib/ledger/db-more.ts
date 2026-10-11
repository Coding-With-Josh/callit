/**
 * ledger/db-more — helpers.
 */
import { sql } from '@vercel/postgres';
import { aggregateStats, type LedgerRow, type LedgerStatus } from '@/types/ledger';
import { baseUnitsFromJson, baseUnitsJsonSchema, baseUnitsToUsdcDecimal, usdcDecimalToBaseUnits } from '@/types/money';
import { unixSeconds } from '@/types/time';
import { txSignatureSchema, marketIdSchema, orderIdSchema, quoteIdSchema, walletAddressSchema } from '@/types/ids';

export async function getBySignature(signature: string): Promise<LedgerRow | null> {
  try {
    const r = await sql<{
      signature: string;
      wallet: string;
      market_id: string;
      side: 'YES'|'NO';
      amount_usdc_base: bigint;
      amount_usdc_dec: string;
      source_app: string;
      source_surface: string;
      order_id: string;
      quote_id: string;
      status: LedgerStatus;
      volume_class: any;
      created_at: bigint;
      updated_at: bigint;
      report_attempts: number;
      last_error: any;
    }>`SELECT * FROM ledger WHERE signature=${txSignatureSchema.parse(signature)}`;
    if (r.rows.length===0) return null;
    const row = r.rows[0]!;
    return {
      signature: txSignatureSchema.parse(row.signature),
      wallet: walletAddressSchema.parse(row.wallet),
      marketId: marketIdSchema.parse(row.market_id),
      side: row.side.toLowerCase() as 'yes'|'no',
      amountUsdc: row.amount_usdc_dec as any,
      source:{app:row.source_app as any, surface:row.source_surface as any},
      orderId: orderIdSchema.parse(row.order_id),
      quoteId: quoteIdSchema.parse(row.quote_id),
      status: row.status,
      volumeClass: row.volume_class,
      createdAt: unixSeconds(Number(row.created_at)),
      updatedAt: unixSeconds(Number(row.updated_at)),
      reportAttempts: row.report_attempts,
      lastError: row.last_error,
    } satisfies LedgerRow;
  } catch {
    return null;
  }
}

export async function listUnreported(maxAgeSeconds = 300): Promise<readonly LedgerRow[]> {
  const cutoff = unixSeconds(Math.floor(Date.now()/1000)-maxAgeSeconds);
  const r = await sql<{
    signature:string;wallet:string;market_id:string;side:'YES'|'NO';
    amount_usdc_base:bigint;amount_usdc_dec:string;
    source_app:string;source_surface:string;
    order_id:string;quote_id:string;status:LedgerStatus;volume_class:any;
    created_at:bigint;updated_at:bigint;report_attempts:number;last_error:any;
  }>`SELECT * FROM ledger WHERE status IN ('submitted','pending_report') AND created_at <= ${Number(cutoff)}`;
  return r.rows.map(row=>({
    signature: txSignatureSchema.parse(row.signature),
    wallet: walletAddressSchema.parse(row.wallet),
    marketId: marketIdSchema.parse(row.market_id),
    side: row.side.toLowerCase() as 'yes'|'no',
    amountUsdc: row.amount_usdc_dec as any,
    source:{app:row.source_app as any, surface:row.source_surface as any},
    orderId: orderIdSchema.parse(row.order_id),
    quoteId: quoteIdSchema.parse(row.quote_id),
    status: row.status,
    volumeClass: row.volume_class,
    createdAt: unixSeconds(Number(row.created_at)),
    updatedAt: unixSeconds(Number(row.updated_at)),
    reportAttempts: row.report_attempts,
    lastError: row.last_error,
  })) satisfies LedgerRow[];
}

export async function computeStats() {
  const r = await sql<{amount_usdc_base:bigint,status:any,volume_class:any,wallet:string,source_app:string,source_surface:string}>`
    SELECT amount_usdc_base,status,volume_class,wallet,source_app,source_surface FROM ledger
  `;
  const rows = r.rows.map(x=>{
    const units = x.amount_usdc_base;
    const dec = baseUnitsToUsdcDecimal(baseUnitsFromJson(baseUnitsJsonSchema.parse(units.toString())));
    return {
      signature: txSignatureSchema.parse('11111111111111111111111111111111'),
      wallet: walletAddressSchema.parse(x.wallet),
      marketId: marketIdSchema.parse('demo'),
      side: 'yes' as any,
      amountUsdc: dec,
      source:{app:x.source_app as any,surface:x.source_surface as any},
      orderId: orderIdSchema.parse('o'),
      quoteId: quoteIdSchema.parse('q'),
      status: x.status as any,
      volumeClass: x.volume_class,
      createdAt: unixSeconds(0),updatedAt: unixSeconds(0),reportAttempts:0,
      lastError: undefined,
    } satisfies LedgerRow;
  });
  return aggregateStats(rows);
}
