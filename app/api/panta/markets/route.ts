/**
 * GET /api/panta/markets — a page of the public market catalog.
 *
 * Query params are validated against an explicit allow-list; unknown params are
 * ignored and a bad value is a 400. Values are passed straight to the client,
 * which validates the upstream response shape.
 *
 * Phase 1 (complete mediation): the guard runs BEFORE the query is parsed
 * (Phase 3: G1) so an anonymous caller cannot probe the query schema via a
 * 400-vs-401 difference, and cannot spend the shared read budget (Phase 3: G2).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { marketCategorySlugSchema, marketPhaseWireSchema } from '@/types';
import { fetchMarketList } from '@/lib/panta/read-adapters';
import {
  NO_STORE,
  pantaClientOr503,
  requirePantaAuth,
  transportErrorResponse,
} from '@/lib/panta/route-helpers';

/** URL-shaped version of the list query (all values arrive as strings). */
const listQuerySchema = z.object({
  category: marketCategorySlugSchema.optional(),
  phase: marketPhaseWireSchema.optional(),
  status: z.string().max(32).optional(),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;

  // Guard before parsing: an unauthenticated caller learns nothing, not even
  // whether their query was well formed.
  const guard = await requirePantaAuth(request);
  if ('response' in guard) return guard.response;

  const params = request.nextUrl.searchParams;
  const parsed = listQuerySchema.safeParse({
    category: params.get('category') ?? undefined,
    phase: params.get('phase') ?? undefined,
    status: params.get('status') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    limit: params.get('limit') ?? undefined,
  });
  if (!parsed.success) {
    // Field errors only — never echo the raw input back as a page.
    return NextResponse.json(
      { error: 'invalid market query', fields: parsed.error.flatten().fieldErrors },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await fetchMarketList(ready.client, parsed.data);
  if (!result.ok) return transportErrorResponse(result.error);

  return NextResponse.json(
    {
      markets: result.value.markets,
      nextCursor: result.value.nextCursor,
      disclaimer: result.value.disclaimer,
      provenance: 'live',
      asOf: new Date().toISOString(),
    },
    { headers: NO_STORE },
  );
}
