/**
 * GET /api/panta/positions?wallet=... — proxy to Panta positions.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { pantaClientOr503, transportErrorResponse, NO_STORE } from '@/lib/panta/route-helpers';
import { fetchPositions } from '@/lib/panta/positions-adapters';
import { walletAddressSchema } from '@/types/ids';

export async function GET(req: NextRequest) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;
  const { searchParams } = new URL(req.url);
  const wallet = searchParams.get('wallet') ?? '';
  const parsed = walletAddressSchema.safeParse(wallet);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid wallet' }, { status: 400, headers: NO_STORE });
  }
  const r = await fetchPositions(ready.client, parsed.data);
  if (!r.ok) return transportErrorResponse(r.error);
  return NextResponse.json(r.value, { status: 200, headers: NO_STORE });
}
