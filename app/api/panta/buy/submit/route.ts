/**
 * POST /api/panta/buy/submit — report a signed, broadcast order to Panta.
 *
 * The wallet has ALREADY submitted the transaction by the time this runs (one
 * prompt signs and sends), so the order may exist on-chain and the funds may
 * already have moved. Every status this route returns has to respect that: it can
 * report success, or it can say "not recorded yet", but it must never imply the
 * order did not happen.
 *
 * Phase 1 (complete mediation): the session guard is applied here, per route. The
 * wallet is re-derived from the session (`auth.wallet`) and never taken from the
 * caller; only `{ orderId, signature }` is read from the body, and the upstream
 * body is rebuilt from exactly those two plus the session wallet, so a caller
 * cannot smuggle extra fields through.
 *
 * Phase 2 (no internals in a response body): the caught error's message and any
 * upstream body stay server-side — an unexpected throw is a 502 with fixed copy.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { pantaClientOr503, submitErrorStatus, transportOf, NO_STORE } from '@/lib/panta/route-helpers';
import { submitBuyOrder } from '@/lib/panta/buy-adapters';
import { requireAuthFromRequest } from '@/lib/auth/require-auth';
import type { BuyAdaptersConfig } from '@/lib/panta/buy-adapters';

export async function POST(req: NextRequest) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;
  const auth = await requireAuthFromRequest(req);
  if (!auth.ok) return NextResponse.json({ error:auth.error }, { status:auth.status, headers:NO_STORE });
  let body: unknown; try { body = await req.json(); } catch { body=null; }
  if (!body||typeof body!=='object') return NextResponse.json({ error:'invalid body' }, { status:400, headers:NO_STORE });
  const b = body as { orderId?: unknown; signature?: unknown };
  if (typeof b.orderId!=='string' || typeof b.signature!=='string') return NextResponse.json({ error:'orderId+signature required' }, { status:400, headers:NO_STORE });
  const cfg: BuyAdaptersConfig={client:ready.client,wallet:auth.wallet};
  try {
    const r = await submitBuyOrder(cfg,{ orderId:b.orderId, signature:b.signature });
    return NextResponse.json(r,{status:200,headers:NO_STORE});
  } catch (e){
    const transport = transportOf(e);
    if (transport) {
      // submitErrorStatus, not transportErrorStatus: `TX_NOT_FOUND` here is a
      // visibility lag on an order that is ALREADY on-chain, and must be a 503
      // the client retries with the same signature — never a status that reads
      // as "nothing happened".
      return NextResponse.json(
        { error: 'submit failed' },
        { status: submitErrorStatus(transport), headers: NO_STORE },
      );
    }
    // Phase 2 (fail closed): an UNEXPECTED throw is still a refusal, and its
    // message is never returned to the caller.
    return NextResponse.json({ error:'submit failed' },{ status:502, headers:NO_STORE });
  }
}
