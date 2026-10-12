/**
 * /actions.json — the Solana Actions domain mapping document.
 *
 * Owns: the one rule that makes a plain `https://<origin>/blink/<id>?side=…`
 * URL recognisable as a Blink by a client that has not been handed an explicit
 * `solana-action:` URL. Without this file a shared link is just a link.
 * Must not import: adapters, React, or any stateful module.
 *
 * Phase 3 (open redirect / SSRF): both patterns are absolute, single-slash paths
 * on OUR OWN origin, and the schema in `types/blink` enforces that. A rule is a
 * statement about our own host; a value that could carry a host (or a `//`
 * protocol-relative form) would turn this document into an open redirect for
 * every Blink client that trusts it.
 *
 * Scope note (deliberate): only `/blink/**` is mapped. Mapping `/markets/**` to
 * the same actions would make every existing market link unfurl as a Blink
 * instead of a regular card — a product change with its own review, and one that
 * also depends on the dialect registry's timing. It is a one-line addition here
 * when that decision is made.
 */
import { NextResponse } from 'next/server';
import { actionsJsonSchema, type ActionsJson } from '@/types';
import { actionHeaders } from '@/lib/blink/action-headers';

/**
 * Validated at module load, so a malformed rule fails the deploy rather than
 * shipping a document that silently mis-routes every Blink client.
 */
const ACTIONS_JSON: ActionsJson = actionsJsonSchema.parse({
  rules: [{ pathPattern: '/blink/**', apiPath: '/blink/**' }],
});

/** Preflight, identical headers to every other Action endpoint on this domain. */
export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 200, headers: actionHeaders() });
}

export function GET(): NextResponse {
  return NextResponse.json(ACTIONS_JSON, {
    status: 200,
    // Public, but short: a rule change must not take an hour to take effect.
    headers: actionHeaders({ 'Cache-Control': 'public, max-age=300' }),
  });
}
