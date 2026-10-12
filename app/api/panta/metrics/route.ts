/**
 * GET /api/panta/metrics?limit=... — proxy to Panta account metrics.
 *
 * Phase 1 (complete mediation): a read is not free here — it spends a paid,
 * shared-budget upstream account. The route now requires a session, and the
 * guard runs BEFORE `limit` is parsed (Phase 3: G1) so an anonymous caller
 * cannot read a 400-vs-401 difference as a schema probe.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  NO_STORE,
  pantaClientOr503,
  requirePantaAuth,
  transportErrorResponse,
} from '@/lib/panta/route-helpers';
import { fetchAccountMetrics } from '@/lib/panta/metrics-adapters';

export async function GET(req: NextRequest) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;

  const guard = await requirePantaAuth(req);
  if ('response' in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const limitStr = searchParams.get('limit') ?? '100';
  const limit = Number(limitStr);
  const r = await fetchAccountMetrics(ready.client, Number.isFinite(limit) ? Math.min(Math.max(1,limit),1000) : 100);
  if (!r.ok) return transportErrorResponse(r.error);
  return NextResponse.json(r.value, { status: 200, headers: NO_STORE });
}
