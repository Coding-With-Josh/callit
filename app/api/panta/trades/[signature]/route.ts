/**
 * GET /api/panta/trades/[signature] — trade status.
 */
import { NextResponse } from 'next/server';
import { pantaClientOr503, transportErrorResponse, NO_STORE } from '@/lib/panta/route-helpers';
import { getTradeStatus } from '@/lib/panta/trades-adapters';
import { txSignatureSchema } from '@/types/ids';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ signature: string }> },
) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;
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
    return NextResponse.json({ error: e?.message||'trade status failed' }, { status: 502, headers: NO_STORE });
  }
}
