/**
 * panta/positions-adapters — positions read (HTTP).
 */
import { positionsResponseSchema, type PositionsResponse } from '@/types/panta-wire/positions';
import type { PantaClient, PantaTransportError } from './client';
import { err, ok, type Result } from '@/types/result';

export async function fetchPositions(
  client: PantaClient,
  wallet: string,
): Promise<Result<PositionsResponse, PantaTransportError>> {
  const r = await client.request({
    method: 'GET',
    path: '/positions/',
    query: { wallet },
    schema: positionsResponseSchema,
  });
  if (!r.ok) return err(r.error);
  return ok(r.value);
}
