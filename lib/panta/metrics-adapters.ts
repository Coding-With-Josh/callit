/**
 * panta/metrics-adapters — account metrics read (HTTP).
 */
import { accountMetricsResponseSchema, type AccountMetricsResponse } from '@/types/panta-wire/metrics';
import type { PantaClient, PantaTransportError } from './client';
import { err, ok, type Result } from '@/types/result';
import { PantaCallError } from './client';

export async function fetchAccountMetrics(
  client: PantaClient,
  limit = 100,
): Promise<Result<AccountMetricsResponse, PantaTransportError>> {
  const r = await client.request({
    method: 'GET',
    path: '/account/metrics/',
    query: { limit },
    schema: accountMetricsResponseSchema,
  });
  if (!r.ok) return err(r.error);
  return ok(r.value);
}
