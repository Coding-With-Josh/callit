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
 * Phase 2 (no internals leak): a failure result carries a status and, when the
 * mint itself failed, WHICH kind of mint failure it was — a closed enum of
 * fixed strings, never body text. The response body is never read on a non-2xx
 * response, so no upstream message can reach a caller through this path.
 */
'use client';

import { mintSession } from './session-client';
import type { SessionFailureKind } from '@/lib/auth/session-mint';

export type AuthedJsonResult =
  | { readonly ok: true; readonly data: unknown }
  | {
      readonly ok: false;
      readonly status: number;
      /**
       * Present ONLY when a 401 could not be explained as "you are signed out":
       * either the session mint that was supposed to fix it also failed, or it
       * reported success and the request was *still* anonymous. A bare 401 is
       * indistinguishable from "signed out", which is a lie when the wallet pill
       * is showing a connected wallet — this field is how a caller tells them
       * apart. Fixed enum; never response body text.
       */
      readonly sessionFailure?: SessionFailureKind;
    };

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
 *
 * A 401 that survives the retry is NOT reported as a plain 401: either the mint
 * failed (`sessionFailure` = the mint's own kind) or the mint succeeded and the
 * session still was not accepted (`sessionFailure: 'not-persisted'`). Both are
 * more specific than "you are signed out", which is what a bare 401 implies and
 * what left a connected user staring at "Connect your wallet".
 */
export async function authedJson(
  path: string,
  init: { readonly method?: 'GET' | 'POST'; readonly body?: unknown } = {},
): Promise<AuthedJsonResult> {
  const method = init.method ?? 'GET';
  const first = await requestJson(path, method, init.body);
  if (first.ok || first.status !== 401) return first;
  const minted = await mintSession();
  if (minted.status !== 'ok') {
    // The retry cannot help if there is no session to retry with.
    return { ok: false, status: first.status, sessionFailure: minted.status };
  }
  const retried = await requestJson(path, method, init.body);
  if (retried.ok || retried.status !== 401) return retried;
  // The mint said it landed, yet we are still anonymous. Distinct from a mint
  // failure, and distinct from "signed out" — name it instead of guessing.
  return { ok: false, status: retried.status, sessionFailure: 'not-persisted' };
}
