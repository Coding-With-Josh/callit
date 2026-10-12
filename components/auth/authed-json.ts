/**
 * auth/authed-json — the same-origin JSON fetch shared by the money-adjacent
 * client flows.
 *
 * Owns: the fetch itself, the single bounded session-mint retry on a 401, and
 * nothing else. The user-facing copy for a failed status stays with each flow —
 * a buy failure and a create failure do not say the same thing.
 * Must not import: React, or any flow-specific module.
 *
 * Phase 1 (complete mediation): the retry is bounded to exactly ONE attempt, so
 * a route that always 401s can never become a loop. Nothing here grants
 * privilege — the cookie it relies on is re-verified server-side at every use.
 *
 * Phase 2 (no internals leak): a failure result carries only a status. The
 * response body is never read on a non-2xx response, so no upstream message can
 * reach a caller through this path.
 */
'use client';

import { mintSession } from './session-client';

export type AuthedJsonResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly status: number };

async function requestJson(
  path: string,
  method: 'GET' | 'POST',
  body: unknown,
): Promise<AuthedJsonResult> {
  try {
    const response = await fetch(path, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, data: await response.json() };
  } catch {
    // Network/proxy failure. Never surface the underlying error.
    return { ok: false, status: 0 };
  }
}

/**
 * Same-origin JSON request; on a 401, mint a fresh server session and retry
 * exactly once. `status: 0` means the request never completed (offline/proxy).
 */
export async function authedJson(
  path: string,
  init: { readonly method?: 'GET' | 'POST'; readonly body?: unknown } = {},
): Promise<AuthedJsonResult> {
  const method = init.method ?? 'GET';
  const first = await requestJson(path, method, init.body);
  if (first.ok || first.status !== 401) return first;
  const minted = await mintSession();
  if (minted.status !== 'ok') return first;
  return requestJson(path, method, init.body);
}
