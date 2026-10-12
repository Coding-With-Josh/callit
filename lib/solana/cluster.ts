/**
 * solana/cluster — which Solana cluster this build authenticates and signs for.
 *
 * Owns: the single source of truth for the cluster, derived from the public
 * `NEXT_PUBLIC_SOLANA_CLUSTER` env var, plus the two projections the rest of
 * the app needs (the wallet-standard chain id and the SIWS `Chain ID` value)
 * and the pure message-stamping helper.
 *
 * Must not import: React, Next, Privy, or any UI module — so it runs in the
 * browser (auth modal / signer hook) and in Node (unit tests) identically.
 *
 * Phase 1 (B0, fail-closed config): the product ships for Solana MAINNET. Only
 * the exact literal `'devnet'` opts into Devnet; anything else — undefined,
 * empty, a typo, `localnet`, `Mainnet` — resolves to `mainnet`. A misread of
 * this var can therefore never move a production build onto Devnet.
 *
 * Phase 1 (B2) / Phase 3 (newline injection): `withSiwsChain` is the ONLY place
 * this app edits a Privy-generated SIWS message. It is pure, line-anchored, and
 * its replacement value is a closed union — never untrusted input.
 *
 * Honest limit: `NEXT_PUBLIC_*` is inlined into the client bundle and is
 * visible/editable by anyone. The cluster is a build/deployment input, NOT a
 * security control; the security control remains Privy's server-side
 * signature + nonce verification. This module cannot and does not enforce
 * anything on the server.
 */

/** The Solana clusters this product supports. */
export type SolanaCluster = 'mainnet' | 'devnet';

/**
 * Wallet-standard chain identifier — the value wallets advertise in their
 * `chains` array and the value passed as `chain` to `solana:signTransaction`.
 */
export type SolanaChain = 'solana:mainnet' | 'solana:devnet';

/**
 * The value written into the SIWS message's `Chain ID:` line. This is the bare
 * cluster name without the `solana:` prefix (the SIWS/CAIP-122 wallet-facing
 * form Privy's template uses — `Chain ID: mainnet`).
 */
export type SiwsChainId = 'mainnet' | 'devnet';

/** The production posture. Used whenever the env var is absent or unrecognised. */
const DEFAULT_CLUSTER: SolanaCluster = 'mainnet';

/**
 * Resolve a raw env value to a cluster, fail-closed to `mainnet`.
 *
 * Pure and exported so the fail-closed rule is unit-testable without touching
 * `process.env` (Phase 4b).
 */
export function resolveCluster(raw: string | undefined | null): SolanaCluster {
  return raw === 'devnet' ? 'devnet' : DEFAULT_CLUSTER;
}

/**
 * The cluster for this build. Read as a static `process.env.…` property access
 * so Next inlines the value into the client bundle (destructuring or dynamic
 * access would not be replaced).
 */
export const SOLANA_CLUSTER: SolanaCluster = resolveCluster(
  process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
);

/** Wallet-standard chain id for `SOLANA_CLUSTER`. */
export const SOLANA_CHAIN: SolanaChain =
  SOLANA_CLUSTER === 'devnet' ? 'solana:devnet' : 'solana:mainnet';

/** SIWS `Chain ID` value for `SOLANA_CLUSTER`. */
export const SIWS_CHAIN_ID: SiwsChainId = SOLANA_CLUSTER;

/**
 * Matches the `Chain ID: <value>` line in a CAIP-122 / SIWS message.
 *
 * `/m` makes `^`/`$` anchor to line starts/ends; `.` does not match a newline,
 * so the match can never spill across lines. A non-global `String.replace`
 * below rewrites only the FIRST such line (Phase 3: an injected second line
 * cannot override the stamped one).
 */
const CHAIN_ID_LINE = /^Chain ID: .+$/m;

/**
 * Stamp `chainId` onto a Privy-generated SIWS message.
 *
 * The Privy SDK hard-codes `Chain ID: mainnet` into the message it builds:
 *
 *   `${host} wants you to sign in with your Solana account:\n${address}\n\n…`
 *   `…URI: ${origin}\nVersion: 1\nChain ID: mainnet\nNonce: ${nonce}\n…`
 *
 * A wallet switched to Devnet refuses to render that request ("the chain ID
 * does not match"), so the user can never sign in. This rewrites the declared
 * chain to the configured cluster. The nonce is server-issued and untouched, so
 * the signature/nonce binding is unchanged.
 *
 * Fail-closed (Phase 2):
 *  - `mainnet` is a strict pass-through — the SDK already emits `mainnet`, and
 *    leaving the bytes untouched keeps production login identical to today.
 *  - `devnet` throws if the line is absent, because we cannot then guarantee a
 *    devnet-scoped message, and signing a mainnet-labelled one is the bug.
 *  - `devnet` also throws if the rewrite is a no-op, so a future SDK change that
 *    silently drops/renames the line surfaces as a failure rather than a
 *    wallet-refused signature.
 */
export function withSiwsChain(message: string, chainId: SiwsChainId): string {
  if (chainId === 'mainnet') return message;

  if (!CHAIN_ID_LINE.test(message)) {
    throw new Error(
      'SIWS message has no "Chain ID" line to stamp — cannot prepare a devnet login',
    );
  }
  const rewritten = message.replace(CHAIN_ID_LINE, `Chain ID: ${chainId}`);
  if (rewritten === message) {
    throw new Error('SIWS "Chain ID" rewrite did not change the message');
  }
  return rewritten;
}
