/**
 * panta/trades-adapters — trade report and status (HTTP).
 */
import {
  tradeReportRequestSchema,
  tradeReportResponseSchema,
  tradeStatusResponseSchema,
} from '@/types/panta-wire/trades';
import type { PantaClient } from './client';
import { PantaCallError } from './client';

export interface TradesAdaptersConfig {
  readonly client: PantaClient;
}

export async function reportTrade(
  config: TradesAdaptersConfig,
  args: { signature: string; wallet?: string; marketId?: string; quoteId?: string; userId?: string },
): Promise<{ status: string; kind?: 'buy' | 'claim' }> {
  const body = tradeReportRequestSchema.parse(args);
  const r = await config.client.request({
    method: 'POST',
    path: '/trades/',
    body,
    schema: tradeReportResponseSchema,
  });
  if (!r.ok) throw new PantaCallError(r.error);
  return { status: r.value.status, kind: r.value.kind };
}

export async function getTradeStatus(
  config: TradesAdaptersConfig,
  signature: string,
): Promise<'processed' | 'pending_attribution' | 'unknown' | 'failed'> {
  const r = await config.client.request({
    method: 'GET',
    path: `/trades/${signature}/`,
    schema: tradeStatusResponseSchema,
  });
  if (!r.ok) throw new PantaCallError(r.error);
  return r.value.status;
}
