/**
 * auth/require-auth — auth guard helpers.
 *
 * Owns: getSession + requireAuth (server-side). Maps failures to generic auth errors.
 * No UI imports.
 */
import type { AuthError, Identity, Session } from '@/types/auth';
import { getSession as readSession } from './session';
import { err, ok, type Result } from '@/types/result';

export async function getSession(): Promise<Session> {
  return readSession();
}

export async function getIdentity(): Promise<Result<Identity, AuthError>> {
  const s = await getSession();
  if (s.identity) return ok(s.identity);
  return err({ kind: 'unauthorized' });
}

/** Throws/returns shaped error; caller maps to HTTP. Use from server routes. */
export async function requireAuth(): Promise<Identity> {
  const r = await getIdentity();
  if (r.ok) return r.value;
  // Map to shape; let route layer translate to 401/403/503.
  throw r.error;
}
