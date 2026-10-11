/**
 * POST /api/panta/buy/quote — primary order quote.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { pantaClientOr503, transportErrorResponse, NO_STORE } from '@/lib/panta/route-helpers';
import { requestBuyQuote } from '@/lib/panta/buy-adapters';
import { usdcDecimalSchema } from '@/types/money';
import { requireAuthFromRequest } from '@/lib/auth/require-auth';
import type { BuyAdaptersConfig } from '@/lib/panta/buy-adapters';

export async function POST(req: NextRequest) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;
  const auth = await requireAuthFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: NO_STORE });
  }
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== 'object') return NextResponse.json({ error:'invalid body' }, { status:400, headers:NO_STORE });
  const b = body as any;
  if (typeof b.marketId !== 'string' || (b.side!=='YES' && b.side!=='NO')) return NextResponse.json({ error:'marketId and side required' }, { status:400, headers:NO_STORE });
  const amt = usdcDecimalSchema.safeParse(b.amountUsdc);
  if (!amt.success) return NextResponse.json({ error:'invalid amountUsdc' }, { status:400, headers:NO_STORE });
  const cfg: BuyAdaptersConfig = { client: ready.client, wallet: auth.wallet };
  try {
    const q = await requestBuyQuote(cfg, { marketId:b.marketId, side:b.side, amountUsdc:amt.data, userId:b.userId });
    return NextResponse.json(q, { status:200, headers:NO_STORE });
  } catch (e:any) {
    if (e?.transport) return transportErrorResponse(e.transport);
    return NextResponse.json({ error:e?.message||'quote failed' }, { status:502, headers:NO_STORE });
  }
}
