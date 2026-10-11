/**
 * auth/session — HTTP-only session cookie for Callit.
 *
 * Owns: set/get/clear of the session cookie, plus the anonymous default.
 * Server-only (uses next/headers + NextResponse). No Privy types.
 *
 * Fail-closed: the cookie is a signed envelope (see session-cookie.ts). Anything
 * that does not verify — missing/weak secret, bad signature, wrong version,
 * malformed payload, or expiry — is treated as anonymous. A session cookie is
 * never issued unsigned.
 */
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { Session, SessionId } from '@/types/auth';
import { sessionIdSchema } from '@/types/auth';
import { decodeSessionCookie, encodeSessionCookie } from './session-cookie';

const COOKIE_NAME =
  process.env.NODE_ENV === 'production' ? '__Host-callit-session' : 'callit-session';
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function newSessionId(): SessionId {
  // randomUUID is fine; the schema allows 16-128 chars (a UUID is 36).
  return sessionIdSchema.parse(randomUUID());
}

function anonymousSession(): Session {
  const t = now();
  return {
    id: newSessionId(),
    identity: null,
    createdAt: t,
    expiresAt: t + DEFAULT_MAX_AGE_SECONDS,
  };
}

export function getCookieName(): string {
  return COOKIE_NAME;
}

export async function getSession(): Promise<Session> {
  const jar = await cookies();
  const c = jar.get(COOKIE_NAME);
  if (!c) return anonymousSession();

  // Fail closed: no secret, bad signature, wrong version, malformed payload, or
  // expiry all yield an anonymous session (Phase 3: forged cookie).
  const decoded = decodeSessionCookie(c.value);
  if (!decoded) return anonymousSession();
  if (decoded.expiresAt <= now()) return anonymousSession();
  return decoded;
}

export function setSessionCookie(res: NextResponse, session: Session): NextResponse {
  const encoded = encodeSessionCookie(session);
  if (!encoded) {
    // Cannot sign (no/weak SESSION_SECRET): never issue an unsigned identity
    // cookie — clear any existing one and leave the caller anonymous.
    return clearSessionCookie(res);
  }
  const maxAge = Math.max(0, session.expiresAt - now());
  res.cookies.set({
    name: COOKIE_NAME,
    value: encoded,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
