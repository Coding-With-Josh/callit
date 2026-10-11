/**
 * auth/session route — session state + verify + clear.
 *
 * GET:    current session (no secrets). 200 always.
 * POST:   verify a Privy token and establish a signed session cookie.
 *         400 (missing token) / 401 (bad token) / 403 (no linked wallet) /
 *         503 (identity provider down).
 * DELETE: clear the session. 204.
 *
 * Fail-closed (Phase 2): any throw -> 401 with no cookie set. Errors returned to
 * the client are generic strings — no stack traces, no secret, no token echo.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { setSessionCookie, clearSessionCookie, getSession } from '@/lib/auth/session';
import { createPrivyIdentityVerifier } from '@/lib/auth/identity-verifier';
import { sessionIdSchema, type Session } from '@/types/auth';
import { serverEnvSchema } from '@/types/env';
import { unixSeconds } from '@/types/time';
import { NO_STORE } from '@/lib/panta/route-helpers';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function loadConfig() {
  const env = serverEnvSchema.parse({
    PANTA_API_KEY: process.env.PANTA_API_KEY,
    PANTA_API_BASE_URL: process.env.PANTA_API_BASE_URL,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
  });
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) throw new Error('missing app id');
  return { appId, appSecret: env.PRIVY_APP_SECRET };
}

export async function GET() {
  const s = await getSession();
  return NextResponse.json(
    {
      authenticated: !!s.identity,
      userId: s.identity?.userId ?? null,
      wallet: s.identity?.wallet ?? null,
    },
    { status: 200, headers: NO_STORE },
  );
}

export async function POST(req: NextRequest) {
  try {
    const cfg = loadConfig();
    const body = await req.json().catch(() => null);
    const token = body?.token;
    if (typeof token !== 'string' || token.length === 0) {
      return NextResponse.json(
        { error: 'missing token' },
        { status: 400, headers: NO_STORE },
      );
    }

    const verifier = await createPrivyIdentityVerifier({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
    });
    const r = await verifier.verifyToken(token);
    if (!r.ok) {
      const e = r.error;
      if (e.kind === 'forbidden' && e.reason === 'no-wallet') {
        return NextResponse.json(
          { error: 'no linked solana wallet' },
          { status: 403, headers: NO_STORE },
        );
      }
      if (e.kind === 'unavailable') {
        return NextResponse.json(
          { error: 'auth dependency unavailable' },
          { status: 503, headers: NO_STORE },
        );
      }
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401, headers: NO_STORE },
      );
    }

    const now = unixSeconds(Math.floor(Date.now() / 1000));
    const session: Session = {
      // Server-generated, validated before it enters the signed envelope.
      id: sessionIdSchema.parse(randomUUID()),
      identity: r.value,
      createdAt: now,
      expiresAt: unixSeconds(now + SESSION_TTL_SECONDS),
    };
    const res = NextResponse.json(
      { ok: true },
      { status: 200, headers: NO_STORE },
    );
    return setSessionCookie(res, session);
  } catch {
    // Fail closed: no session established, generic error only.
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    );
  }
}

export async function DELETE() {
  const res = new NextResponse(null, { status: 204, headers: NO_STORE });
  return clearSessionCookie(res);
}
