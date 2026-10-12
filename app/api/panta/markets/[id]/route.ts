/**
 * GET /api/panta/markets/{id} — a single market.
 *
 * The [id] is validated against a strict charset before it is ever placed in a
 * Panta URL path (never URL-encoded into a path we do not control). A
 * non-conforming id is a 404, not a 400 — an enumeration probe learns nothing.
 *
 * Phase 1 (complete mediation): a session is required, and the guard runs BEFORE
 * the charset test (Phase 3: G1), so an anonymous caller cannot learn the id
 * charset from a 404-vs-401 difference, nor spend the shared read budget.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { fetchMarket } from '@/lib/panta/read-adapters';
import {
  NO_STORE,
  pantaClientOr503,
  requirePantaAuth,
  transportErrorResponse,
} from '@/lib/panta/route-helpers';

/** Market ids are slugs/keys; anything else is not one of ours. */
const MARKET_ID = /^[A-Za-z0-9_-]{1,128}$/;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;

  const guard = await requirePantaAuth(request);
  if ('response' in guard) return guard.response;

  const { id } = await context.params;

  // Phase 3 (path injection / enumeration): reject before touching the network.
  if (!MARKET_ID.test(id)) {
    return NextResponse.json(
      { error: 'market not found' },
      { status: 404, headers: NO_STORE },
    );
  }

  const result = await fetchMarket(ready.client, id);
  if (!result.ok) return transportErrorResponse(result.error);
  if (result.value.market === null) {
    return NextResponse.json(
      { error: 'market not found' },
      { status: 404, headers: NO_STORE },
    );
  }

  return NextResponse.json(
    {
      market: result.value.market,
      disclaimer: result.value.disclaimer,
      provenance: 'live',
      asOf: new Date().toISOString(),
    },
    { headers: NO_STORE },
  );
}
