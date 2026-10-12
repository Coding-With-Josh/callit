/**
 * GET /api/panta/trades/[signature] — trade status.
 *
 * Phase 1 (complete mediation): requires a session before the signature is
 * parsed or any upstream call is made, so this is not an anonymous read proxy
 * to the paid, shared-budget Panta account.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  NO_STORE,
  pantaClientOr503,
  requirePantaAuth,
  transportErrorResponse,
} from '@/lib/panta/route-helpers';
import { getTradeStatus } from '@/lib/panta/trades-adapters';
import { txSignatureSchema } from '@/types/ids';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ signature: string }> },
) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;

  // Guard before parsing: an unauthenticated caller learns nothing, not even
  // whether their signature was well formed.
  const guard = await requirePantaAuth(req);
  if ('response' in guard) return guard.response;

  const { signature } = await params;
  const parsed = txSignatureSchema.safeParse(signature);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400, headers: NO_STORE });
  }
  try {
    const status = await getTradeStatus({ client: ready.client }, parsed.data);
    return NextResponse.json({ signature: parsed.data, status }, { status: 200, headers: NO_STORE });
  } catch (e: any) {
    if (e?.transport) return transportErrorResponse(e.transport);
    // Phase 2 (no internals in a response body): an UNEXPECTED throw is still a
    // refusal, and its message (`e.message`) is never returned to the caller.
    // This previously echoed it, which could surface an upstream body fragment
    // or an internal path.
    return NextResponse.json({ error: 'trade status failed' }, { status: 502, headers: NO_STORE });
  }
}
