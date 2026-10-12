/**
 * POST /api/sources/verify — the reachability check behind the create wizard's
 * verified-source gate.
 *
 * AUTH POSTURE (changed 2026-10-12): this route no longer requires a session.
 * It used to (the ONLY route that did so while the wizard could be reached
 * before any wallet connect), and that coupling made the gate unusable: the
 * check had to mint a Privy-backed session first, and the mint's token read
 * (`getIdentityToken` -> `GET /api/v1/users/me`) is RATE-LIMITED by Privy, so the
 * user hit 429s and a "connect your wallet" dead end while demonstrably signed
 * in. Product decision: the source gate must not depend on a wallet session.
 *
 * The auth guard was NEVER the SSRF defense here — it was an abuse brake. The
 * SSRF controls below are unchanged and independent of auth. The brake is now
 * `checkSourceRateLimit` (best-effort, in-process; see that module for its
 * stated limits).
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
 * Documented residual (not closed): the rate limit is per-process and keyed on a
 * spoofable header, so it does not stop a determined attacker (see
 * lib/panta/source-rate-limit.ts). A durable limiter needs a shared store this
 * app does not have yet; it is flagged here rather than assumed handled.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { NO_STORE } from '@/lib/panta/route-helpers';
import { sourceVerifyBodySchema } from '@/lib/panta/create-requests';
import { createSourceVerifier } from '@/lib/panta/source-verifier';
import {
  checkSourceRateLimit,
  clientKey,
} from '@/lib/panta/source-rate-limit';

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Abuse brake, applied before the body is even read. Fail-closed: over
  // budget means no fetch happens at all.
  const limit = checkSourceRateLimit(clientKey(req), Date.now());
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'too many source checks' },
      {
        status: 429,
        headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSeconds) },
      },
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
