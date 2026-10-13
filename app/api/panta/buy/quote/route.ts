/**
 * POST /api/panta/buy/quote — primary order quote.
 *
 * Phase 1 (complete mediation): behind the session guard, like every other route
 * under app/api/panta. The body operands are validated at the perimeter (Phase 4)
 * before the adapter sees them. Only `{ marketId, side, amountUsdc }` is read:
 * `userId` is deliberately NOT taken from the body — it is Panta's volume
 * attribution tag, so a caller who could set it could attribute their own order
 * to another surface (Phase 3: attribution injection). The wire body is rebuilt
 * from the validated operands plus the session wallet, so no extra field can be
 * smuggled upstream.
 *
 * Phase 3 (false copy about the caller's operands): a failure here is mapped with
 * `quoteErrorStatus`, not the shared `transportErrorStatus`. Forwarding Panta's
 * 400 verbatim made a missing on-chain price read ("the market could not be
 * quoted on this request") read to the user as "that order isn't valid, check the
 * amount" — a false statement about operands that were fine.
 *
 * Phase 2 (no internals in a response body): the caught error's message and any
 * upstream body stay server-side — an unexpected throw is a 502 with fixed copy.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  pantaClientOr503,
  quoteErrorStatus,
  transportErrorResponseMapped,
  transportOf,
  NO_STORE,
} from '@/lib/panta/route-helpers';
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
  const b = body as { marketId?: unknown; side?: unknown; amountUsdc?: unknown };
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
    const q = await requestBuyQuote(cfg, { marketId:marketId.data, side:side.data, amountUsdc:amt.data });
    return NextResponse.json(q, { status:200, headers:NO_STORE });
  } catch (e) {
    // `transportOf`, never a cast-and-read: it returns null for ANY non-transport
    // throw, so a bug's own message can never reach the response.
    const transport = transportOf(e);
    if (transport) return transportErrorResponseMapped(transport, quoteErrorStatus);
    // Phase 2 (no internals in a response body): an UNEXPECTED throw is still a
    // refusal, and its message is never returned to the caller.
    return NextResponse.json({ error:'quote failed' }, { status:502, headers:NO_STORE });
  }
}
