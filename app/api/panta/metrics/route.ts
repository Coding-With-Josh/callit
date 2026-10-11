/**
 * GET /api/panta/metrics?limit=... — proxy to Panta account metrics.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { pantaClientOr503, transportErrorResponse, NO_STORE } from '@/lib/panta/route-helpers';
import { fetchAccountMetrics } from '@/lib/panta/metrics-adapters';

export async function GET(req: NextRequest) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;
  const { searchParams } = new URL(req.url);
  const limitStr = searchParams.get('limit') ?? '100';
  const limit = Number(limitStr);
  const r = await fetchAccountMetrics(ready.client, Number.isFinite(limit) ? Math.min(Math.max(1,limit),1000) : 100);
  if (!r.ok) return transportErrorResponse(r.error);
  return NextResponse.json(r.value, { status: 200, headers: NO_STORE });
}
