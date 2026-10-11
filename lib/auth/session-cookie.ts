/**
 * auth/session-cookie — the signed session envelope (pure; no Next imports).
 *
 * Owns: encoding a `Session` into a tamper-evident cookie value and decoding one
 * back, fail-closed. Envelope shape: `v1.<base64url(json)>.<base64url(hmac)>`.
 *
 * Integrity only (HMAC-SHA256 over the payload, keyed by `SESSION_SECRET`). The
 * payload is the holder's own identity, so confidentiality is not the goal —
 * forgery is, and the signature is what closes it (Phase 3: forged cookie).
 *
 * Fail-closed contract:
 *   - no/short secret  -> encode returns null (nothing issued), decode returns null
 *   - wrong version / bad signature / malformed JSON / bad schema -> decode null
 *   - an identity that is present but invalid decodes to identity=null, never a
 *     partial identity.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  sessionIdSchema,
  userIdSchema,
  type Identity,
  type Session,
} from '@/types/auth';
import { walletAddressSchema } from '@/types/ids';

const ENVELOPE_VERSION = 'v1';
const MIN_SECRET_CHARS = 32;

/** The signing secret, or null when absent/too weak (fail closed). */
export function sessionSecret(
  env: Record<string, string | undefined> = process.env,
): Buffer | null {
  const raw = env.SESSION_SECRET;
  if (typeof raw !== 'string' || raw.length < MIN_SECRET_CHARS) return null;
  return Buffer.from(raw, 'utf8');
}

function hmac(payloadB64: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

/** Encode a Session into a signed cookie value, or null when it cannot be signed. */
export function encodeSessionCookie(
  session: Session,
  env?: Record<string, string | undefined>,
): string | null {
  const secret = sessionSecret(env);
  if (!secret) return null; // cannot sign -> never issue an identity cookie
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString(
    'base64url',
  );
  return `${ENVELOPE_VERSION}.${payload}.${hmac(payload, secret)}`;
}

/** Decode + verify a cookie value; returns null on ANY failure (fail closed). */
export function decodeSessionCookie(
  value: string,
  env?: Record<string, string | undefined>,
): Session | null {
  const secret = sessionSecret(env);
  if (!secret) return null; // cannot verify -> anonymous

  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [version, payload, signature] = parts;
  if (version !== ENVELOPE_VERSION || !payload || !signature) return null;

  const expected = hmac(payload, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // Length check first: timingSafeEqual throws on length mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null; // forged/tampered

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8'),
    );
    return coerceSession(parsed);
  } catch {
    return null;
  }
}

/** Validate a decoded payload into a Session; unknown/malformed fields fail closed. */
function coerceSession(parsed: unknown): Session | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;

  const id = sessionIdSchema.safeParse(p.id);
  if (!id.success) return null;
  if (typeof p.createdAt !== 'number' || typeof p.expiresAt !== 'number') {
    return null;
  }

  let identity: Identity | null = null;
  if (p.identity && typeof p.identity === 'object') {
    const ip = p.identity as Record<string, unknown>;
    const uid = userIdSchema.safeParse(ip.userId);
    const wallet = walletAddressSchema.safeParse(ip.wallet);
    // Present-but-invalid identity -> drop to null (never a partial identity).
    if (uid.success && wallet.success) {
      identity = {
        userId: uid.data,
        wallet: wallet.data,
        linkedAt: typeof ip.linkedAt === 'number' ? ip.linkedAt : p.createdAt,
      };
    }
  }

  return {
    id: id.data,
    identity,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
  };
}
