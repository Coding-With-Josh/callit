/**
 * blink/action-headers — the CORS + Solana Actions response headers.
 *
 * Owns: the exact headers every Action endpoint on this domain must return
 * (OPTIONS preflight, GET metadata, POST transaction and actions.json).
 * Must not import: React or Next.
 *
 * Why a shared module: the spec requires the headers to be *identical* on the
 * preflight and on the real response, and requires them on actions.json too. A
 * client whose preflight passes but whose real response omits `ACAO` fails
 * opaquely, so this is one constant every route spreads.
 *
 * Phase 3 (CORS `*` + credentials): these endpoints are intentionally public,
 * cross-origin and cookie-free. A Blink is wallet-signed, not session-signed, so
 * we advertise `Access-Control-Allow-Origin: *` and deliberately do NOT send
 * `Access-Control-Allow-Credentials` — a browser therefore will not attach
 * cookies to these requests, and the Blink routes never read the session anyway.
 */
import { SOLANA_CLUSTER } from '@/lib/solana/cluster';

/** The Actions spec version this surface targets (mirrors `actionVersionSchema`). */
export const ACTION_VERSION = '0';

/** CAIP-2 chain ids for the two clusters this codebase can be built for. */
const BLOCKCHAIN_ID_MAINNET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const BLOCKCHAIN_ID_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

/**
 * The chain whose transactions this build returns, as a CAIP-2 id. Derived from
 * the build's cluster so a devnet build does not claim mainnet. Note the POST
 * refuses to build a transaction on anything but mainnet (see the route), so in
 * practice only a mainnet build ever hands back a transaction.
 */
export const BLOCKCHAIN_IDS =
  SOLANA_CLUSTER === 'devnet' ? BLOCKCHAIN_ID_DEVNET : BLOCKCHAIN_ID_MAINNET;

/** Whether this build may assemble and return a Blink transaction at all. */
export const BLINK_TRADING_ENABLED = SOLANA_CLUSTER === 'mainnet';

/**
 * CORS + Actions headers for a public action response. `extra` is spread last so
 * a route can add `Cache-Control` without being able to drop a CORS header.
 */
export function actionHeaders(
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, Content-Encoding, Accept-Encoding',
    'Access-Control-Expose-Headers': 'X-Action-Version, X-Blockchain-Ids',
    'X-Action-Version': ACTION_VERSION,
    'X-Blockchain-Ids': BLOCKCHAIN_IDS,
    // Phase 3 (index-state injection): these are JSON, not documents. The
    // `X-Robots-Tag` is the whole story here — a robots.txt `/blink/` disallow
    // was deliberately NOT added (it is redundant with this header and would
    // block the very unfurl crawlers Blinks depend on).
    'X-Robots-Tag': 'noindex, nofollow',
    ...extra,
  };
}
