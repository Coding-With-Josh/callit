/**
 * auth/privy-server — server-side Privy client factory (seam).
 *
 * Reads server env; constructs Privy server client when deps present.
 * Server-only. Fail-closed if missing config.
 */
import { serverEnvSchema } from '@/types/env';

export interface PrivyServerConfig {
  readonly appId: string;
  readonly appSecret: string;
}

export function loadPrivyServerConfig(): PrivyServerConfig {
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
  if (!appId) {
    throw new Error('NEXT_PUBLIC_PRIVY_APP_ID missing');
  }
  return { appId, appSecret: env.PRIVY_APP_SECRET };
}

export async function createPrivyServerClient() {
  const cfg = loadPrivyServerConfig();
  const mod = await import('@privy-io/server-auth');
  return new mod.PrivyClient(cfg.appId, cfg.appSecret);
}
