/**
 * auth — identity, session, and verification types.
 *
 * Owns: branded IDs for identity + the `IdentityVerifier` seam. No Privy types.
 * Must not import: UI, Next, or framework modules that pull client code.
 */
import { z } from 'zod';
import type { WalletAddress } from './ids';
import type { Result } from './result';

export const userIdSchema = z
  .string()
  .min(1)
  .max(128)
  .brand<'UserId'>();
export type UserId = z.infer<typeof userIdSchema>;

/** Verified identity bound to a wallet. */
export interface Identity {
  readonly userId: UserId;
  readonly wallet: WalletAddress;
  readonly linkedAt: number; // Unix seconds
}

export const sessionIdSchema = z
  .string()
  .min(16)
  .max(128)
  .brand<'SessionId'>();
export type SessionId = z.infer<typeof sessionIdSchema>;

/** Server-side session state. */
export interface Session {
  readonly id: SessionId;
  readonly identity: Identity | null;
  readonly createdAt: number; // Unix seconds
  readonly expiresAt: number; // Unix seconds
}

export type AuthError =
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'forbidden'; readonly reason: 'no-wallet' }
  | { readonly kind: 'unavailable' };

/** Injectable identity verifier (server-only). */
export interface IdentityVerifier {
  /** Verify a raw identity token from the auth provider and return identity. */
  verifyToken(token: string): Promise<Result<Identity, AuthError>>;
}