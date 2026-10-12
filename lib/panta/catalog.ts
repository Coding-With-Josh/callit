/**
 * panta/catalog — server-side catalog reads for the hosted surfaces.
 *
 * Owns: the one place the landing Browse and /markets/[id] get their data. It
 * tries the live Panta read through the transport (which holds the API key,
 * server-only) and falls back to the labeled fixtures ONLY when the live read is
 * unavailable. A fixture is never presented as live: the fallback carries
 * `provenance: "fixture"`, and a live response's sandbox `disclaimer` is carried
 * through so pk_test data cannot read as a real market either.
 * Must not import: React or Next. Server-only in practice (reads the key env via
 * pantaClientFromEnv), but it never returns the client or the key — only domain
 * objects safe to serialize into a server component.
 *
 * Failure contract (Phase 2): every path returns a value; nothing throws out. A
 * live failure degrades to fixtures rather than erroring or hanging.
 */
import { asOf, type AsOf, type DataProvenance, type Result } from '@/types';
import {
  getMarketFixture,
  listMarketFixtures,
  type MarketFixture,
} from '@/lib/market-fixtures';
import {
  pantaClientFromEnv,
  type PantaClient,
  type PantaTransportError,
} from './client';
import { fetchMarket, fetchMarketList } from './read-adapters';

/** How the loaders obtain a client. Injectable so tests never touch the env/network. */
export type PantaClientProvider = () => Result<PantaClient, PantaTransportError>;

/** A page of the catalog plus where it came from. */
export interface CatalogListing {
  readonly items: readonly MarketFixture[];
  readonly provenance: DataProvenance;
  /** The API's sandbox notice, when one was sent; null for no notice / fixtures. */
  readonly disclaimer: string | null;
}

function nowAsOf(): AsOf {
  return asOf(new Date().toISOString());
}

/** The labeled fallback used whenever the live read cannot be trusted. */
function fixtureListing(): CatalogListing {
  return { items: listMarketFixtures(), provenance: 'fixture', disclaimer: null };
}

/**
 * Maximum live reads for one loader call. `client.ts` deliberately keeps retry
 * policy out of the transport ("retry policy is the caller's"); this constant is
 * the caller side of that contract, and it is a hard bound — Phase 3 (cost
 * blowout / retry amplification).
 */
const PRICE_READ_ATTEMPTS = 6;

/**
 * Pacing before a re-read: ~100–250ms, flat across attempts.
 *
 * Deliberately NOT exponential backoff. The lean variant is a per-request
 * lottery (identical concurrent requests land on priced and unpriced backends at
 * the same instant), so the value of a re-read is re-rolling the request, not
 * waiting for recovery — a longer backoff would only add render latency without
 * improving the odds. The jitter keeps parallel renders from re-synchronising
 * into an upstream burst when the whole site sees the same degraded window.
 */
function priceRetryDelayMs(): number {
  return 100 + Math.floor(Math.random() * 150);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Repeat a read ONLY while the upstream keeps succeeding but returns no odds.
 *
 * Panta's list and detail fill `yesPrice`/`noPrice` (and `volumeUsdc`) only when
 * their RPC-backed price read succeeds; the same rows come back with every price
 * null otherwise (OpenAPI: "catalog row + spot prices when RPC available").
 * Observed live: identical requests alternate between all-priced and all-null,
 * independently per request — so a re-read is a genuine second chance, not a
 * no-op (Phase 2: assumption under stress).
 *
 * Fail-safe rules (Phase 2/3):
 * - a transport failure (401/429/5xx/timeout/network) is terminal after ONE
 *   attempt, so a rate-limited or failing upstream is never retried into a
 *   storm — `result.ok` gates the loop before any sleep;
 * - an empty page is a valid answer and is never retried;
 * - exhausting the attempts returns the last read as-is (prices null), never a
 *   substituted, cached-as-live, or fabricated price.
 */
async function readUntilPriced<T>(
  read: () => Promise<Result<T, PantaTransportError>>,
  isPriced: (value: T) => boolean,
): Promise<Result<T, PantaTransportError>> {
  let result = await read();
  for (
    let attempt = 2;
    attempt <= PRICE_READ_ATTEMPTS && result.ok && !isPriced(result.value);
    attempt += 1
  ) {
    await sleep(priceRetryDelayMs());
    result = await read();
  }
  return result;
}

/**
 * The market list for the landing Browse.
 *
 * Live on success (even when empty — an empty live catalog is honest); fixtures
 * on any failure: no key, network/timeout, schema drift, or a malformed item
 * (read-adapters fails the whole page rather than truncating the catalog).
 *
 * A page whose rows all lack odds is a degraded upstream read, not an empty one,
 * and is re-read a bounded number of times (see `readUntilPriced`).
 */
export async function loadMarketListing(
  limit = 24,
  getClient: PantaClientProvider = pantaClientFromEnv,
): Promise<CatalogListing> {
  try {
    const ready = getClient();
    if (!ready.ok) return fixtureListing();

    const result = await readUntilPriced(
      () => fetchMarketList(ready.value, { limit }),
      // Zero rows = a genuinely empty catalog (terminal). Rows with no odds at
      // all = the lean upstream variant (retry).
      (page) =>
        page.markets.length === 0 ||
        page.markets.some((market) => market.yesPrice !== null),
    );
    if (!result.ok) return fixtureListing();

    const readAt = nowAsOf();
    const items: MarketFixture[] = result.value.markets.map((market) => ({
      market,
      asOf: readAt,
      provenance: 'live',
      disclaimer: result.value.disclaimer,
    }));
    return {
      items,
      provenance: 'live',
      disclaimer: result.value.disclaimer,
    };
  } catch {
    // Fail closed to fixtures on any unexpected throw (never a half-render).
    return fixtureListing();
  }
}

/**
 * The market detail read.
 *
 * Live on success; a live 404 or any failure falls back to a known fixture id
 * (labeled) — so demo ids still render without a key — and an unknown id
 * resolves to null, which the page turns into `notFound()`. An id that is not a
 * plain slug is rejected by the read adapter before any network call.
 *
 * Same price re-read as the listing: the detail endpoint also carries the lean
 * (no-odds) variant, and this read is what the detail page renders its odds and
 * volume from.
 */
export async function loadMarket(
  id: string,
  getClient: PantaClientProvider = pantaClientFromEnv,
): Promise<MarketFixture | null> {
  try {
    const ready = getClient();
    if (ready.ok) {
      // The re-read re-enters `fetchMarket`, so MARKET_ID_PATTERN and the
      // transport's SAFE_PATH/origin guards run on every attempt — the id owns
      // its own validation rather than relying on a check hoisted above the
      // loop (Phase 3: path injection via a retried request).
      const result = await readUntilPriced(
        () => fetchMarket(ready.value, id),
        // A 404 (market: null) is terminal; only a present-but-unpriced market
        // is treated as the degraded variant.
        (read) => read.market === null || read.market.yesPrice !== null,
      );
      if (result.ok && result.value.market !== null) {
        return {
          market: result.value.market,
          asOf: nowAsOf(),
          provenance: 'live',
          disclaimer: result.value.disclaimer,
        };
      }
    }
  } catch {
    // Fall through to the fixture lookup.
  }
  // Not live (or not found live): a known fixture id still renders, labeled.
  return getMarketFixture(id);
}
