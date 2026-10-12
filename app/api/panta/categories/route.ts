/**
 * GET /api/panta/categories — the category allowlist.
 *
 * Read-only, server-side: the browser never sees the Panta key. Fail-closed to
 * 503 when the key is unset and to 502/504 on upstream failure.
 *
 * Phase 1 (complete mediation): the payload is public catalog data, so the guard
 * here is a BUDGET control, not a confidentiality one — the upstream account is
 * paid and shared, and an anonymous caller must not spend its reads. Do not read
 * the 401 as "this data is secret".
 */
import { NextResponse, type NextRequest } from 'next/server';
import { fetchCategories } from '@/lib/panta/read-adapters';
import {
  NO_STORE,
  pantaClientOr503,
  requirePantaAuth,
  transportErrorResponse,
} from '@/lib/panta/route-helpers';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;

  const guard = await requirePantaAuth(req);
  if ('response' in guard) return guard.response;

  const result = await fetchCategories(ready.client);
  if (!result.ok) return transportErrorResponse(result.error);

  return NextResponse.json(
    {
      categories: result.value.categories,
      disclaimer: result.value.disclaimer,
      provenance: 'live',
      asOf: new Date().toISOString(),
    },
    { headers: NO_STORE },
  );
}
