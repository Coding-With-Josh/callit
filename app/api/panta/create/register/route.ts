/**
 * POST /api/panta/create/register — submit the signed create. THE money step.
 *
 * This is the only route in the app that can cause a real market to exist
 * on-chain and a real payment to move, because Panta submits the transaction the
 * user just signed. It is deliberately a separate call from the build (which only
 * assembles the transaction) and from signing (which happens in the browser), so
 * that "sign" and "submit" are two distinct, separately-intentioned actions.
 *
 * Phase 1 (complete mediation): the session guard is applied here, per route, so
 * this file cannot inherit it — and cannot silently skip it either. The body is
 * a STRICT object of exactly `{ createId, signature }`; there is no `wallet`
 * field, and none is sent upstream, because register's contract does not accept
 * one. The `createId` was bound to the session wallet when its quote was opened
 * with `auth.wallet`, and the signature can only have been produced by that
 * wallet's fee payer, so authority here comes from the signature rather than
 * from anything the caller can assert.
 *
 * Phase 2 (fail closed): a missing key is a 503, a missing session a 401, a bad
 * body a 400 — all before any upstream call. An unexpected throw is a 502 with
 * fixed copy. The caught error's message, the API key, and any upstream body
 * stay server-side.
 *
 * Phase 3 (misattributed failure): an upstream 400 is NOT forwarded as a 400.
 * At this stage a 400 would be rendered as "that draft isn't valid", pointing at
 * fields the user cannot fix, which is false. The documented error CODE decides
 * whether the create session is finished (409) or the submission merely failed
 * (400, safely retryable — a failed submit does not consume the createId).
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  NO_STORE,
  pantaClientOr503,
  registerErrorStatus,
  transportOf,
} from '@/lib/panta/route-helpers';
import { registerCreate } from '@/lib/panta/create-adapters';
import { createRegisterBodySchema } from '@/lib/panta/create-requests';
import { requireAuthFromRequest } from '@/lib/auth/require-auth';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Fail closed before anything else: without the server key there is nothing.
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
  const parsed = createRegisterBodySchema.safeParse(body);
  if (!parsed.success) {
    // Phase 2: fixed copy — never zod's issue tree, which quotes the rejected
    // input back to the caller. Nothing has been submitted at this point.
    return NextResponse.json(
      { error: 'invalid create register request' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const marketId = await registerCreate(
      ready.client,
      parsed.data.createId,
      parsed.data.signature,
    );
    // The response carries ONLY the market id: the upstream body (status,
    // signature, title, images, category) has no business reaching the client.
    return NextResponse.json({ marketId }, { status: 200, headers: NO_STORE });
  } catch (error) {
    const transport = transportOf(error);
    if (transport) {
      // registerErrorStatus, not transportErrorStatus: only the register step
      // must re-read the 400's documented code before choosing a status.
      return NextResponse.json(
        { error: 'create register failed' },
        { status: registerErrorStatus(transport), headers: NO_STORE },
      );
    }
    // Phase 2 (fail closed): an UNEXPECTED throw is still a refusal. Its message
    // is never returned to the caller.
    return NextResponse.json(
      { error: 'create register failed' },
      { status: 502, headers: NO_STORE },
    );
  }
}
