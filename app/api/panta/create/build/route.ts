/**
 * POST /api/panta/create/build — build the unsigned create transaction.
 *
 * Phase 1 (complete mediation): session guard applied here, per route. The
 * request carries only a `createId`; the wallet sent upstream is `auth.wallet`
 * from the session, so a create session that belongs to another wallet cannot be
 * built against this one (Phase 3: cross-account build).
 *
 * Phase 2 (fail closed): the adapter refuses an empty transaction before it can
 * reach a wallet, and an unexpected throw is a 502 with fixed copy.
 *
 * Still no money and no broadcast: this only asks Panta to assemble the
 * transaction. Nothing is signed here and nothing is registered.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  NO_STORE,
  pantaClientOr503,
  transportErrorResponse,
  transportOf,
} from '@/lib/panta/route-helpers';
import { buildCreateTransaction } from '@/lib/panta/create-adapters';
import { createBuildBodySchema } from '@/lib/panta/create-requests';
import { requireAuthFromRequest } from '@/lib/auth/require-auth';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ready = pantaClientOr503();
  if ('response' in ready) return ready.response;

  const auth = await requireAuthFromRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: NO_STORE },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const parsed = createBuildBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid create build request' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const build = await buildCreateTransaction(
      ready.client,
      auth.wallet, // Phase 3: the session wallet, always sent with the session id.
      parsed.data.createId,
    );
    return NextResponse.json(build, { status: 200, headers: NO_STORE });
  } catch (error) {
    const transport = transportOf(error);
    if (transport) return transportErrorResponse(transport);
    return NextResponse.json(
      { error: 'create build failed' },
      { status: 502, headers: NO_STORE },
    );
  }
}
