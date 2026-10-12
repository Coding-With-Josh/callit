/**
 * POST /api/panta/buy/build — build order.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { pantaClientOr503, transportErrorResponse, NO_STORE } from '@/lib/panta/route-helpers';
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
  const b=body as any;
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
    const o = await buildBuyOrder(cfg,{ quoteId:b.quoteId, userId:b.userId, maxSlippageBps:b.maxSlippageBps });
    return NextResponse.json(o,{status:200,headers:NO_STORE});
  } catch (e:any){
    if(e?.transport)return transportErrorResponse(e.transport);
    // Phase 2 (no internals in a response body): an UNEXPECTED throw is still a
    // refusal, and its message is never returned to the caller.
    return NextResponse.json({error:'build failed'},{status:502,headers:NO_STORE});
  }
}
