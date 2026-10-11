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
 * The market list for the landing Browse.
 *
 * Live on success (even when empty — an empty live catalog is honest); fixtures
 * on any failure: no key, network/timeout, schema drift, or a malformed item
 * (read-adapters fails the whole page rather than truncating the catalog).
 */
export async function loadMarketListing(
  limit = 24,
  getClient: PantaClientProvider = pantaClientFromEnv,
): Promise<CatalogListing> {
  try {
    const ready = getClient();
    if (!ready.ok) return fixtureListing();

    const result = await fetchMarketList(ready.value, { limit });
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
 */
export async function loadMarket(
  id: string,
  getClient: PantaClientProvider = pantaClientFromEnv,
): Promise<MarketFixture | null> {
  try {
    const ready = getClient();
    if (ready.ok) {
      const result = await fetchMarket(ready.value, id);
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
