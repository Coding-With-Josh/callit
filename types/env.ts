/**
 * env — validated environment configuration schema.
 *
 * Owns: the split between public (NEXT_PUBLIC_) config and server-only config,
 * plus the explicit list of server-only key names.
 * Must not import: any domain or framework module.
 *
 * Honest limit: TypeScript cannot stop a client module from importing a
 * server-only value. The split here is a naming convention plus a
 * `ServerOnlyEnvKey` union; enforcing it is a lint/boundary job in the app
 * layer (e.g. `server-only` + no-restricted-imports), not a type guarantee.
 */
import { z } from 'zod';

/** Environment variables safe to expose to the browser. */
export const PUBLIC_ENV_KEYS = [
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_PRIVY_APP_ID',
  'NEXT_PUBLIC_SOLANA_CLUSTER',
] as const;
export type PublicEnvKey = (typeof PUBLIC_ENV_KEYS)[number];

/** Environment variables that must never reach the browser. */
export const SERVER_ONLY_ENV_KEYS = [
  'PANTA_API_KEY',
  'PANTA_API_BASE_URL',
  'SOLANA_RPC_URL',
  'DATABASE_URL',
  'LLM_API_KEY',
  'PRIVY_APP_SECRET',
  'SESSION_SECRET',
] as const;
export type ServerOnlyEnvKey = (typeof SERVER_ONLY_ENV_KEYS)[number];

/** Public environment schema (importable by client code by convention). */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().optional(),
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(1),
  /**
   * Solana cluster this build authenticates/signs for. Fail-closed at runtime
   * too (see lib/solana/cluster.ts): only the literal `devnet` opts in.
   */
  NEXT_PUBLIC_SOLANA_CLUSTER: z.enum(['devnet', 'mainnet']).optional().default('mainnet'),
});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** Server-only environment schema. Never import this from a client module. */
export const serverEnvSchema = z.object({
  PANTA_API_KEY: z.string().min(1),
  PANTA_API_BASE_URL: z
    .string()
    .default('https://live-api.panta.market/api/v1'),
  SOLANA_RPC_URL: z.string().min(1).optional().default('https://api.devnet.solana.com'),
  DATABASE_URL: z.string().min(1).optional(),
  LLM_API_KEY: z.string().min(1).optional(),
  PRIVY_APP_SECRET: z.string().min(1),
  /** HMAC key for the signed session cookie. Must be >= 32 chars. */
  SESSION_SECRET: z.string().min(32),
});
export type ServerEnv = z.infer<typeof serverEnvSchema>;
