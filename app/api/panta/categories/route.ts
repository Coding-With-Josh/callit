/**
 * GET /api/panta/categories — the public category allowlist.
 *
 * Read-only, server-side: the browser never sees the Panta key. Fail-closed to
 * 503 when the key is unset and to 502/504 on upstream failure.
 */
import { NextResponse } from 'next/server';
import { fetchCategories } from '@/lib/panta/read-adapters';
import {
  NO_STORE,
  pantaClientOr503,
  transportErrorResponse,
} from '@/lib/panta/route-helpers';

export async function GET(): Promise<NextResponse> {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;

  const result = await fetchCategories(ready.client);
  if (!result.ok) return transportErrorResponse(result.error);

  return NextResponse.json(
    {
      categories: result.value,
      provenance: 'live',
      asOf: new Date().toISOString(),
    },
    { headers: NO_STORE },
  );
}
