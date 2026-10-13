/**
 * POST /api/panta/buy/build — build order.
 *
 * Phase 1 (complete mediation): behind the session guard; the wallet is
 * re-derived from the session and only `{ quoteId, maxSlippageBps }` is read from
 * the body. `userId` is deliberately not read — it is Panta's volume attribution
 * tag, and a caller able to set it could attribute their own order to another
 * surface (Phase 3: attribution injection).
 *
 * Phase 2 (no internals in a response body): `transportOf` returns null for any
 * non-transport throw, so an unexpected failure is a 502 with fixed copy rather
 * than the caught error's own message.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  pantaClientOr503,
  transportErrorResponse,
  transportOf,
  NO_STORE,
} from '@/lib/panta/route-helpers';
import { buildBuyOrder } from '@/lib/panta/buy-adapters';
import { requireAuthFromRequest } from '@/lib/auth/require-auth';
import type { BuyAdaptersConfig } from '@/lib/panta/buy-adapters';

export async function POST(req: NextRequest) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;
  const auth = await requireAuthFromRequest(req);
  if (!auth.ok) return NextResponse.json({ error:auth.error }, { status:auth.status, headers:NO_STORE });
  let body: unknown; try { body = await req.json(); } catch { body=null; }
  if (!body||typeof body!=='object') return NextResponse.json({ error:'invalid body' }, { status:400, headers:NO_STORE });
  const b = body as { quoteId?: unknown; maxSlippageBps?: unknown };
  if (typeof b.quoteId!=='string') return NextResponse.json({ error:'quoteId required' }, { status:400, headers:NO_STORE });
  // Phase 4 (perimeter): maxSlippageBps is optional, but if present it must be
  // the integer range the wire schema accepts — reject it here as a clean 400
  // rather than letting the adapter's zod parse throw.
  if (
    b.maxSlippageBps !== undefined &&
    (typeof b.maxSlippageBps !== 'number' ||
      !Number.isInteger(b.maxSlippageBps) ||
      b.maxSlippageBps < 0 ||
      b.maxSlippageBps > 5000)
  ) {
    return NextResponse.json({ error:'invalid maxSlippageBps' }, { status:400, headers:NO_STORE });
  }
  const cfg: BuyAdaptersConfig={client:ready.client,wallet:auth.wallet};
  try {
    const o = await buildBuyOrder(cfg,{ quoteId:b.quoteId, maxSlippageBps:b.maxSlippageBps as number | undefined });
    return NextResponse.json(o,{status:200,headers:NO_STORE});
  } catch (e){
    const transport = transportOf(e);
    if (transport) return transportErrorResponse(transport);
    // Phase 2 (no internals in a response body): an UNEXPECTED throw is still a
    // refusal, and its message is never returned to the caller.
    return NextResponse.json({error:'build failed'},{status:502,headers:NO_STORE});
  }
}
