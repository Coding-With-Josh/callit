/**
 * require-auth — session-based auth guard for server routes.
 *
 * Returns ok with wallet/userId, or an error + HTTP status. Never throws.
 */
import type { NextRequest } from 'next/server';
import { getSession } from './session';

export type AuthResult =
  | { ok: true; wallet: string; userId?: string }
  | { ok: false; error: string; status: number };

export async function requireAuthFromRequest(req: NextRequest): Promise<AuthResult> {
  try {
    const s = await getSession();
    if (!s.identity) {
      return { ok: false, error: 'unauthorized', status: 401 };
    }
    return {
      ok: true,
      wallet: s.identity.wallet,
      userId: s.identity.userId,
    };
  } catch {
    return { ok: false, error: 'unauthorized', status: 401 };
  }
}

export async function requireAuth() {
  const s = await getSession();
  if (!s.identity) throw new Error('unauthorized');
  return s.identity;
}

export async function getIdentity() {
  const s = await getSession();
  return s.identity ?? null;
}
