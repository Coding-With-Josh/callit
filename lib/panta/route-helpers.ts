/**
 * panta/route-helpers — shared wiring for the server-side Panta routes.
 *
 * Owns: building the client from the server env (fail closed to 503 when the
 * key is absent), the session guard every route behind it must pass, the
 * transport-error -> status/message mapping, and the no-store header.
 * Must not import: React.
 *
 * Scope note: every route under app/api/panta is now behind a session guard —
 * `requirePantaAuth` on the reads (positions, metrics, categories, markets,
 * markets/[id], trades/[signature]) and the equivalent `requireAuthFromRequest`
 * on the writes (buy/*, claim/*). They proxy a paid upstream account on a shared
 * budget, so an unauthenticated caller must not be able to spend it — including
 * on reads. The Blink endpoints under app/blink/ are the deliberate exception,
 * and they do NOT import anything from this module except the transport
 * mapping: they are cookie-free and cross-origin by design, so they carry their
 * own CORS headers and their own (database-backed) budget instead of a session.
 */
import { NextResponse, type NextRequest } from 'next/server';
import {
  pantaClientFromEnv,
  PantaCallError,
  type PantaClient,
  type PantaTransportError,
} from './client';
import { requireAuthFromRequest, type AuthResult } from '@/lib/auth/require-auth';

/** Every catalog read is live and must not be cached or replayed. */
export const NO_STORE = {
  'cache-control': 'no-store',
  // Phase 3 (index-state injection): these handlers return JSON, not documents.
  // A crawler that reaches one (or a link to one) must never index it as a page.
  // Defence in depth behind the robots.txt `Disallow: /api/` rule.
  'X-Robots-Tag': 'noindex, nofollow',
} as const;

/** Either a ready client, or a fail-closed response to return immediately. */
export type PantaRouteReady =
  | { readonly client: PantaClient }
  | { readonly response: NextResponse };

/** Build the client from env, or a 503 response when the key is missing. */
export function pantaClientOr503(): PantaRouteReady {
  const result = pantaClientFromEnv();
  if (result.ok) return { client: result.value };
  return {
    response: NextResponse.json(
      { error: 'Panta is not configured' },
      { status: 503, headers: NO_STORE },
    ),
  };
}

/** The fail-closed 401 every protected Panta route returns. */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: NO_STORE });
}

/**
 * Guard a Panta route behind the session identity.
 *
 * Phase 1 (complete mediation): the Panta routes proxy a paid, shared-budget
 * upstream account, so every one of them must be reached by an identified caller
 * — including reads, which are not free just because they are reads. A caller
 * that fails the check gets a 401 and NO upstream request is made.
 *
 * The guard is applied per route rather than in middleware on purpose: a route
 * added under app/api/panta/ cannot inherit it, so it cannot silently skip it
 * either. Being unguarded is visible in the file.
 */
export async function requirePantaAuth(
  req: NextRequest,
): Promise<
  { readonly auth: Extract<AuthResult, { ok: true }> } | { readonly response: NextResponse }
> {
  const auth = await requireAuthFromRequest(req);
  if (!auth.ok) return { response: unauthorizedResponse() };
  return { auth };
}

/**
 * The HTTP status for a transport error.
 *
 * Split out from `transportErrorResponse` so a caller that needs a DIFFERENT
 * response envelope (the public Actions routes, which must carry CORS headers —
 * Phase 3: a client whose preflight passed but whose error response omits
 * `Access-Control-Allow-Origin` fails opaquely) can reuse the same mapping
 * instead of re-deriving it and drifting.
 */
export function transportErrorStatus(error: PantaTransportError): number {
  if (error.kind === 'http') return error.status >= 500 ? 502 : error.status;
  if (error.kind === 'timeout') return 504;
  if (error.kind === 'config') return 503;
  return 502;
}

/**
 * A user-safe message for a transport error. The body carries only this string —
 * never the API key, request headers, or a raw upstream body.
 */
export function transportErrorMessage(error: PantaTransportError): string {
  if (error.kind === 'http') return error.error.message;
  if (error.kind === 'timeout') return 'Panta did not respond in time';
  if (error.kind === 'config') return 'Panta is not configured';
  return 'Panta request failed';
}

/** Map a transport error to a response. */
export function transportErrorResponse(error: PantaTransportError): NextResponse {
  return NextResponse.json(
    { error: transportErrorMessage(error) },
    { status: transportErrorStatus(error), headers: NO_STORE },
  );
}

/**
 * The upstream transport error behind a thrown `PantaCallError`, or `null` for
 * ANY other throw (a zod failure, a bug, a mapping error).
 *
 * This exists so a route can map an upstream failure to its status without ever
 * putting the caught error's own message into a response: `null` means "we do
 * not know what this was", which must be answered with fixed copy, not with the
 * error text. Never replace this with a cast-and-read — that is exactly how an
 * internal message ends up in a response body.
 */
export function transportOf(error: unknown): PantaTransportError | null {
  return error instanceof PantaCallError ? error.transport : null;
}
