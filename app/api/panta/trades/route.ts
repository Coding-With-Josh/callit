/**
 * POST /api/panta/trades — report trade signature.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { pantaClientOr503, transportErrorResponse, NO_STORE } from '@/lib/panta/route-helpers';
import { reportTrade } from '@/lib/panta/trades-adapters';

export async function POST(req: NextRequest) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400, headers: NO_STORE });
  }
  const b = body as any;
  if (typeof b.signature !== 'string') {
    return NextResponse.json({ error: 'signature required' }, { status: 400, headers: NO_STORE });
  }
  try {
    const r = await reportTrade(ready.client, {
      signature: b.signature,
      wallet: typeof b.wallet==='string'?b.wallet:undefined,
      marketId: typeof b.marketId==='string'?b.marketId:undefined,
      quoteId: typeof b.quoteId==='string'?b.quoteId:undefined,
      userId: typeof b.userId==='string'?b.userId:undefined,
    });
    return NextResponse.json(r, { status: 200, headers: NO_STORE });
  } catch (e: any) {
    if (e?.transport) return transportErrorResponse(e.transport);
    return NextResponse.json({ error: e?.message||'trade report failed' }, { status: 502, headers: NO_STORE });
  }
}
