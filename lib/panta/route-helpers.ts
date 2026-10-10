/**
 * panta/route-helpers — shared wiring for the public Panta *read* routes.
 *
 * Owns: building the client from the server env (fail closed to 503 when the
 * key is absent), mapping a transport error to an HTTP response without leaking
 * internals, and the no-store header.
 * Must not import: React.
 *
 * Scope note: only READ routes exist under app/api/panta. The create/buy/claim
 * write routes are deliberately NOT exposed to the browser until the identity
 * (Privy) layer can authenticate callers; the write adapters live as server code
 * and are exercised by tests.
 */
import { NextResponse } from 'next/server';
import { pantaClientFromEnv, type PantaClient, type PantaTransportError } from './client';

/** Every catalog read is live and must not be cached or replayed. */
export const NO_STORE = { 'cache-control': 'no-store' } as const;

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

/**
 * Map a transport error to a response. The body carries only a generic message
 * (or Panta's own user-facing message for a known error) — never the API key,
 * request headers, or a raw upstream body.
 */
export function transportErrorResponse(error: PantaTransportError): NextResponse {
  if (error.kind === 'http') {
    const status = error.status >= 500 ? 502 : error.status;
    return NextResponse.json(
      { error: error.error.message },
      { status, headers: NO_STORE },
    );
  }
  if (error.kind === 'timeout') {
    return NextResponse.json(
      { error: 'Panta did not respond in time' },
      { status: 504, headers: NO_STORE },
    );
  }
  if (error.kind === 'config') {
    return NextResponse.json(
      { error: 'Panta is not configured' },
      { status: 503, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    { error: 'Panta request failed' },
    { status: 502, headers: NO_STORE },
  );
}
