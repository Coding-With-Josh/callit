/**
 * auth/identity-verifier — identity verification seam.
 *
 * Owns: `IdentityVerifier` interface, `MockIdentityVerifier` (tests), and
 * `createPrivyIdentityVerifier` (real Privy; server-only). Fail-closed.
 *
 * Phase 3 (wallet substitution): the Solana wallet is resolved ONLY from the
 * user object Privy returns for the presented token. It is never taken from a
 * request body, a draft, or any client payload — so a caller cannot make a
 * different wallet the fee payer.
 *
 * Failure mapping is deliberate (Phase 2):
 *   - bad/absent token (verifyAuthToken throws)      -> unauthorized (401)
 *   - valid token, no linked Solana wallet           -> forbidden: no-wallet (403)
 *   - identity provider unreachable (getUser throws) -> unavailable (503)
 */
import { err, ok, type Result } from '@/types';
import type { AuthError, Identity, IdentityVerifier } from '@/types/auth';
import { userIdSchema } from '@/types/auth';
import { walletAddressSchema } from '@/types/ids';
import { unixSeconds } from '@/types/time';

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

/** The minimal shape of a linked account that we read for wallet resolution. */
interface LinkedAccountLike {
  readonly type?: string;
  readonly chainType?: string;
  readonly address?: string;
}

export async function createPrivyIdentityVerifier(
  config: PrivyIdentityVerifierConfig,
): Promise<IdentityVerifier> {
  // Lazy import to keep server-only and avoid bundling if not used.
  const mod = await import('@privy-io/server-auth');
  const client = new mod.PrivyClient(config.appId, config.appSecret);

  return {
    async verifyToken(token: string): Promise<Result<Identity, AuthError>> {
      if (typeof token !== 'string' || token.length === 0) {
        return err({ kind: 'unauthorized' });
      }

      // 1. Cryptographically verify the token. A throw means "not a valid
      //    token" -> unauthorized (fail closed).
      let rawUserId: string;
      try {
        const claims = await client.verifyAuthToken(token);
        rawUserId = claims.userId;
      } catch {
        return err({ kind: 'unauthorized' });
      }

      const uid = userIdSchema.safeParse(rawUserId);
      if (!uid.success) return err({ kind: 'unauthorized' });

      // 2. Resolve the linked Solana wallet server-side. `getUser({ idToken })`
      //    is the documented, rate-limit-safe path (the string overload is
      //    deprecated for rate limits). A throw here is a dependency failure,
      //    not a bad token -> unavailable so the route can answer 503.
      let linked: readonly LinkedAccountLike[];
      try {
        const user = await client.getUser({ idToken: token });
        linked = (user.linkedAccounts ?? []) as readonly LinkedAccountLike[];
      } catch {
        return err({ kind: 'unavailable' });
      }

      // No client-supplied fallback: if the user object does not carry a Solana
      // wallet, this identity cannot sign (403), and we never trust a wallet
      // the caller claims.
      const solana = linked.find(
        (a) => a.type === 'wallet' && a.chainType === 'solana' && !!a.address,
      );
      const wallet = solana
        ? walletAddressSchema.safeParse(solana.address)
        : null;
      if (!wallet || !wallet.success) {
        return err({ kind: 'forbidden', reason: 'no-wallet' });
      }

      return ok({
        userId: uid.data,
        wallet: wallet.data,
        linkedAt: unixSeconds(Math.floor(Date.now() / 1000)),
      });
    },
  };
}
