/**
 * POST /api/panta/claim/build — build win claim.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { pantaClientOr503, transportErrorResponse, NO_STORE } from '@/lib/panta/route-helpers';
import { buildWinClaim } from '@/lib/panta/claim-adapters';
import { requireAuthFromRequest } from '@/lib/auth/require-auth';
import type { ClaimAdaptersConfig } from '@/lib/panta/claim-adapters';

export async function POST(req: NextRequest) {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;
  const auth = await requireAuthFromRequest(req);
  if (!auth.ok) return NextResponse.json({ error:auth.error }, { status:auth.status, headers:NO_STORE });
  let body: unknown; try { body = await req.json(); } catch { body=null; }
  if (!body||typeof body!=='object') return NextResponse.json({ error:'invalid body' }, { status:400, headers:NO_STORE });
  const b=body as any;
  if (typeof b.marketId!=='string') return NextResponse.json({ error:'marketId required' }, { status:400, headers:NO_STORE });
  const cfg: ClaimAdaptersConfig={client:ready.client,wallet:auth.wallet};
  try {
    const c = await buildWinClaim(cfg, b.marketId);
    return NextResponse.json(c,{status:200,headers:NO_STORE});
  } catch (e:any){ if(e?.transport)return transportErrorResponse(e.transport); return NextResponse.json({error:e?.message||'claim build failed'},{status:502,headers:NO_STORE}); }
}
