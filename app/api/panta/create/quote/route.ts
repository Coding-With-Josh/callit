/**
 * POST /api/panta/create/quote — open a Panta create quote.
 *
 * Phase 1 (complete mediation): behind the session guard like every other write
 * under app/api/panta — applied per route, so this file cannot inherit it
 * silently. The wallet is taken from the SESSION (`auth.wallet`) and is never
 * read from the body: `createQuoteBodySchema` is a strict object, so a body that
 * carries a `wallet` (or any unknown key) is refused at the perimeter.
 *
 * Phase 2 (no internals leak): an unexpected throw is a 502 with fixed copy.
 * The caught error's message, the API key, and any upstream body stay server-side.
 *
 * Does not move money and does not register anything: a quote reserves a create
 * session only. Build is a separate call, and signing happens in the browser.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  NO_STORE,
  pantaClientOr503,
  transportErrorResponse,
  transportOf,
} from '@/lib/panta/route-helpers';
import { requestCreateQuote } from '@/lib/panta/create-adapters';
import { createQuoteBodySchema } from '@/lib/panta/create-requests';
import { requireAuthFromRequest } from '@/lib/auth/require-auth';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Fail closed before anything else: without the server key there is no quote.
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
  const parsed = createQuoteBodySchema.safeParse(body);
  if (!parsed.success) {
    // Phase 2: a schema failure returns fixed copy — never zod's issue tree,
    // which quotes the rejected input back to the caller.
    return NextResponse.json(
      { error: 'invalid create quote request' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const quote = await requestCreateQuote(
      ready.client,
      auth.wallet, // Phase 3: bound from the session, never from the body.
      parsed.data.draft,
      parsed.data.imageUrl,
    );
    return NextResponse.json(quote, { status: 200, headers: NO_STORE });
  } catch (error) {
    const transport = transportOf(error);
    if (transport) return transportErrorResponse(transport);
    // Phase 2 (fail closed): an UNEXPECTED throw is still a refusal. Its message
    // is never returned to the caller.
    return NextResponse.json(
      { error: 'create quote failed' },
      { status: 502, headers: NO_STORE },
    );
  }
}
