/**
 * ledger/db-more — helpers that pull in aggregateStats (which uses money math)
 * but we split to avoid circular reasoning; put in a small follow-up file.
 */
import { sql } from '@vercel/postgres';
import { aggregateStats, type LedgerRow } from '@/types/ledger';
import { baseUnitsFromJson, baseUnitsJsonSchema, baseUnitsToUsdcDecimal, usdcDecimalToBaseUnits } from '@/types/money';
import { unixSeconds } from '@/types/time';
import { txSignatureSchema } from '@/types/ids';

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
      status: any;
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
      wallet: row.wallet,
      marketId: row.market_id,
      side: row.side,
      amountUsdc: row.amount_usdc_dec,
      source:{app:row.source_app,surface:row.source_surface},
      orderId: row.order_id,
      quoteId: row.quote_id,
      status: row.status,
      volumeClass: row.volume_class,
      createdAt: unixSeconds(Number(row.created_at)),
      updatedAt: unixSeconds(Number(row.updated_at)),
      reportAttempts: row.report_attempts,
      lastError: row.last_error,
    };
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
    order_id:string;quote_id:string;status:any;volume_class:any;
    created_at:bigint;updated_at:bigint;report_attempts:number;last_error:any;
  }>`SELECT * FROM ledger WHERE status IN ('submitted','pending_report') AND created_at <= ${Number(cutoff)}`;
  return r.rows.map(row=>({
    signature:txSignatureSchema.parse(row.signature),
    wallet:row.wallet,marketId:row.market_id,side:row.side,amountUsdc:row.amount_usdc_dec,
    source:{app:row.source_app,surface:row.source_surface},
    orderId:row.order_id,quoteId:row.quote_id,status:row.status,volumeClass:row.volume_class,
    createdAt:unixSeconds(Number(row.created_at)),updatedAt:unixSeconds(Number(row.updated_at)),
    reportAttempts:row.report_attempts,lastError:row.last_error,
  }));
}

export async function computeStats(): Promise<ReturnType<typeof aggregateStats>> {
  const r = await sql<{amount_usdc_base:bigint,status:any,volume_class:any,wallet:string,source_app:string,source_surface:string}>`
    SELECT amount_usdc_base,status,volume_class,wallet,source_app,source_surface FROM ledger WHERE status='reported' OR status='submitted' OR status='pending_report' OR status='built' OR status='failed' -- full? better restrict to reported+user relevant? but types aggregate any; for now fetch all
  `;
  const rows = r.rows.map(x=>{
    // reconstruct minimal row for aggregate
    const units = x.amount_usdc_base;
    const dec = baseUnitsToUsdcDecimal(baseUnitsFromJson(baseUnitsJsonSchema.parse(units.toString())));
    return {
      signature:'sig' as any,
      wallet:x.wallet,
      marketId:'m' as any,
      side:'YES' as any,
      amountUsdc: dec,
      source:{app:x.source_app,surface:x.source_surface},
      orderId:'o' as any,
      quoteId:'q' as any,
      status:x.status as any,
      volumeClass:x.volume_class as any,
      createdAt:unixSeconds(0),updatedAt:unixSeconds(0),reportAttempts:0,
    } satisfies LedgerRow;
  });
  return aggregateStats(rows);
}
