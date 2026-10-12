/**
 * GET /api/panta/positions?wallet=... — proxy to Panta positions.
 *
 * Phase 1 (complete mediation + IDOR): this route was unauthenticated, so it was
 * an open proxy to a paid upstream AND it would return any wallet's positions to
 * anyone who asked. It now requires a session, and the requested `wallet` must be
 * the session's own wallet. Ownership is enforced HERE, by comparison against the
 * server-side identity — not by the caller's choice of query parameter, and not
 * by the UI.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { NO_STORE, pantaClientOr503, requirePantaAuth, transportErrorResponse } from '@/lib/panta/route-helpers';
import { fetchPositions } from '@/lib/panta/positions-adapters';
import { walletAddressSchema } from '@/types/ids';

export async function GET(req: NextRequest) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;

  // Guard before parsing anything: an unauthenticated caller learns nothing,
  // not even whether their query was well formed.
  const guard = await requirePantaAuth(req);
  if ('response' in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  // Default to the session wallet rather than requiring the caller to repeat it.
  const requested = searchParams.get('wallet') ?? guard.auth.wallet;
  const parsed = walletAddressSchema.safeParse(requested);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid wallet' }, { status: 400, headers: NO_STORE });
  }
  // Phase 3 (IDOR): substitution is refused explicitly rather than silently
  // ignored, so a caller cannot mistake a 200 for access to someone else's data.
  if (parsed.data !== guard.auth.wallet) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers: NO_STORE });
  }

  const r = await fetchPositions(ready.client, parsed.data);
  if (!r.ok) return transportErrorResponse(r.error);
  return NextResponse.json(r.value, { status: 200, headers: NO_STORE });
}
