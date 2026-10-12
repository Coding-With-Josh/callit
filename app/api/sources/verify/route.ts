/**
 * POST /api/sources/verify — the reachability check behind the create wizard's
 * verified-source gate.
 *
 * Phase 1 (complete mediation): session-guarded. This is the ONLY endpoint in
 * the app that fetches a caller-supplied URL, so an anonymous version would be a
 * free SSRF probe and an outbound-request amplifier. The guard is applied here
 * in the file, not in middleware, so a future copy of this route cannot inherit
 * it by accident.
 *
 * Phase 3 (SSRF): the target is validated and EVERY DNS answer checked by
 * `createSourceVerifier` (lib/panta/source-verifier.ts) BEFORE any fetch —
 * scheme allow-list, no embedded credentials, no IP literals, no localhost,
 * private/loopback/link-local/CGNAT/reserved ranges rejected, redirects followed
 * manually with the same checks on every hop (max 3), 8s timeout. The response
 * body of the target is never read; status alone decides.
 *
 * Phase 2 (dependency down): the verifier never throws. An unreachable host, a
 * timeout, or a blocked target is a FAILED check — never an implicit pass, and
 * the create gate that consumes it fails closed the same way.
 *
 * Documented residual (not closed): there is no rate limit on this route. The
 * bounds that do exist are listed above plus the 2048-char body cap and the
 * create schema's 20-source ceiling per draft. Rate limiting needs a store this
 * app does not have yet; it is flagged here rather than assumed handled.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { NO_STORE } from '@/lib/panta/route-helpers';
import { sourceVerifyBodySchema } from '@/lib/panta/create-requests';
import { createSourceVerifier } from '@/lib/panta/source-verifier';
import { requireAuthFromRequest } from '@/lib/auth/require-auth';

export async function POST(req: NextRequest): Promise<NextResponse> {
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
  const parsed = sourceVerifyBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid source check request' },
      { status: 400, headers: NO_STORE },
    );
  }

  // The verdict is safe by construction: `{ ok, reason }` only, both fixed-copy.
  const verdict = await createSourceVerifier()(parsed.data.url);
  return NextResponse.json(verdict, { status: 200, headers: NO_STORE });
}
