/**
 * POST /api/panta/buy/quote — primary order quote.
 *
 * Phase 1 (complete mediation): behind the session guard, like every other route
 * under app/api/panta. The body operands are validated at the perimeter (Phase 4)
 * before the adapter sees them.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { pantaClientOr503, transportErrorResponse, NO_STORE } from '@/lib/panta/route-helpers';
import { requestBuyQuote } from '@/lib/panta/buy-adapters';
import { usdcDecimalSchema } from '@/types/money';
import { marketIdSchema } from '@/types/ids';
import { sideWireSchema } from '@/types';
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
  // Phase 3 (G3, unit/casing confusion): the DOMAIN side is lowercase
  // ('yes'|'no') — the same casing as the wire form. This check previously
  // accepted 'YES'|'NO' and passed it straight to `requestBuyQuote`, whose wire
  // schema then threw a raw ZodError that this route mapped to a 502 carrying
  // validation internals. Accept the domain form only, and validate the id here
  // too, so a malformed operand is a clean 400 at the perimeter instead of a
  // ZodError escaping the adapter.
  const marketId = marketIdSchema.safeParse(b.marketId);
  const side = sideWireSchema.safeParse(b.side);
  if (!marketId.success || !side.success) return NextResponse.json({ error:'marketId and side required' }, { status:400, headers:NO_STORE });
  const amt = usdcDecimalSchema.safeParse(b.amountUsdc);
  if (!amt.success) return NextResponse.json({ error:'invalid amountUsdc' }, { status:400, headers:NO_STORE });
  const cfg: BuyAdaptersConfig = { client: ready.client, wallet: auth.wallet };
  try {
    const q = await requestBuyQuote(cfg, { marketId:marketId.data, side:side.data, amountUsdc:amt.data, userId:b.userId });
    return NextResponse.json(q, { status:200, headers:NO_STORE });
  } catch (e:any) {
    if (e?.transport) return transportErrorResponse(e.transport);
    // Phase 2 (no internals in a response body): an UNEXPECTED throw is still a
    // refusal, and its message is never returned to the caller.
    return NextResponse.json({ error:'quote failed' }, { status:502, headers:NO_STORE });
  }
}
