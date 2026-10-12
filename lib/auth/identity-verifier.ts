/**
 * auth/identity-verifier — identity verification seam.
 *
 * Owns: `IdentityVerifier` interface, `MockIdentityVerifier` (tests), and
 * `createPrivyIdentityVerifier` (real Privy; server-only). Fail-closed.
 *
 * Phase 3 (wallet substitution): the Solana wallet is resolved ONLY from the
 * Privy user record for the userId WE verified from the token signature. It is
 * never taken from a request body, a draft, or any client payload — so a caller
 * cannot make a different wallet the fee payer.
 *
 * WHICH TOKEN (Phase 1 — the bug this fixes): `verifyAuthToken` pins issuer
 * `privy.io`, audience = our appId, and algorithm ES256 against the app's
 * verification key, then reads the userId from `sub`. It does not inspect a
 * token-TYPE claim, so the Privy ACCESS token verifies exactly like the identity
 * token — and the access token is the one the SDK always holds, because the
 * identity token's only source is Privy's rate-limited `GET /users/me` (which
 * also CLEARS the cached identity token when its response omits one). Presenting
 * the access token is the SDK's documented path: "use this token to authorize
 * requests sent from your frontend".
 *
 * The wallet lookup likewise uses our APP credentials
 * (`GET /api/v1/users/{id}`), not the caller's token, so it does not depend on a
 * token the client may be unable to produce.
 *
 * Failure mapping is deliberate (Phase 2):
 *   - bad/absent token (verifyAuthToken throws)       -> unauthorized (401)
 *   - valid token, no linked Solana wallet            -> forbidden: no-wallet (403)
 *   - identity provider unreachable (lookup throws)   -> unavailable (503)
 */
import { err, ok, type Result } from '@/types';
import type { AuthError, Identity, IdentityVerifier } from '@/types/auth';
import { userIdSchema } from '@/types/auth';
import { unixSeconds } from '@/types/time';
import { selectLinkedSolanaWallet, type LinkedAccountLike } from './linked-wallet';

export class MockIdentityVerifier implements IdentityVerifier {
  constructor(private identity: Identity | null = null) {}
  async verifyToken(token: string): Promise<Result<Identity, AuthError>> {
    if (!token) return err({ kind: 'unauthorized' });
    if (this.identity) return ok(this.identity);
    return err({ kind: 'unauthorized' });
  }
  setIdentity(identity: Identity | null): void {
    this.identity = identity; // mutable for tests only
  }
}

export interface PrivyIdentityVerifierConfig {
  readonly appId: string;
  readonly appSecret: string;
}

/**
 * The minimal shape of a linked account that we read for wallet resolution.
 *
 * Kept as a local alias of the shared type so the call site reads the same as
 * before while the selection RULE lives in ./linked-wallet (pure, tested).
 */
type LinkedAccount = LinkedAccountLike;

/**
 * Process-wide Privy client.
 *
 * Hoisted deliberately: `verifyAuthToken` needs the app's verification key,
 * which the SDK fetches from `getAppSettings()` and memoises ON THE CLIENT
 * INSTANCE. Constructing a client per request would spend one rate-limited
 * Privy call per mint re-fetching a key that never changes.
 *
 * Keyed by appId so a config change (or a test) cannot silently reuse a client
 * built for a different app.
 */
let cachedClient: { appId: string; client: PrivyClientLike } | null = null;

interface PrivyClientLike {
  verifyAuthToken(token: string): Promise<{ userId: string }>;
  getUserById(userId: string): Promise<{
    linkedAccounts?: readonly LinkedAccount[];
  }>;
}

async function privyClientFor(
  config: PrivyIdentityVerifierConfig,
): Promise<PrivyClientLike> {
  // Lazy import to keep server-only and avoid bundling if not used.
  const mod = await import('@privy-io/server-auth');
  if (!cachedClient || cachedClient.appId !== config.appId) {
    cachedClient = {
      appId: config.appId,
      client: new mod.PrivyClient(config.appId, config.appSecret),
    };
  }
  return cachedClient.client;
}

export async function createPrivyIdentityVerifier(
  config: PrivyIdentityVerifierConfig,
): Promise<IdentityVerifier> {
  const client = await privyClientFor(config);

  return {
    async verifyToken(token: string): Promise<Result<Identity, AuthError>> {
      if (typeof token !== 'string' || token.length === 0) {
        return err({ kind: 'unauthorized' });
      }

      // 1. Cryptographically verify the token. A throw means "not a valid
      //    token" -> unauthorized (fail closed). The signature is what makes
      //    the userId trustworthy; everything below is keyed off it.
      let rawUserId: string;
      try {
        const claims = await client.verifyAuthToken(token);
        rawUserId = claims.userId;
      } catch {
        return err({ kind: 'unauthorized' });
      }

      const uid = userIdSchema.safeParse(rawUserId);
      if (!uid.success) return err({ kind: 'unauthorized' });

      // 2. Resolve the linked accounts for the VERIFIED userId, using our app
      //    credentials. A throw here is a dependency failure, not a bad token
      //    -> unavailable so the route can answer 503.
      let linked: readonly LinkedAccount[];
      try {
        const user = await client.getUserById(uid.data);
        linked = user.linkedAccounts ?? [];
      } catch {
        return err({ kind: 'unavailable' });
      }

      // No client-supplied fallback: if the user record carries no Solana
      // wallet, this identity cannot sign (403), and we never trust a wallet
      // the caller claims.
      const wallet = selectLinkedSolanaWallet(linked);
      if (!wallet) {
        return err({ kind: 'forbidden', reason: 'no-wallet' });
      }

      return ok({
        userId: uid.data,
        wallet,
        linkedAt: unixSeconds(Math.floor(Date.now() / 1000)),
      });
    },
  };
}
