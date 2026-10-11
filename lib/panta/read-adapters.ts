/**
 * panta/read-adapters — wire -> domain reads for the public catalog.
 *
 * Owns: the mapping from Panta wire markets to the domain `Market`, and the
 * three catalog reads (categories, market list, market detail). The wire
 * schemas have already validated the *shape*; this layer validates the *values*
 * (brands, price ranges, USDC decimals) and fails closed on anything it cannot
 * map to the domain.
 * Must not import: React, Next, or any UI module.
 *
 * Fail-closed rules:
 * - A structural/id/volume/time that cannot be branded fails that market, and
 *   (for a list) the whole response — a shape drift must be loud, not a silently
 *   truncated catalog.
 * - A present-but-out-of-range price degrades to `null` rather than showing a
 *   number we do not trust (a null price disables the buy panel; a wrong one
 *   would not).
 */
import {
  categoriesResponseSchema,
  err,
  marketIdSchema,
  marketListResponseSchema,
  marketWireSchema,
  ok,
  priceSchema,
  unixSeconds,
  usdcDecimalSchema,
  type Market,
  type MarketWire,
  type Price,
  type Result,
  type UnixSeconds,
} from '@/types';
import type { PantaClient, PantaTransportError } from './client';
import { wireIsoToUnixSeconds } from './client';

/**
 * The only shape a market id may take. A Panta market id is a slug/key; this
 * excludes `/`, `.` and `%`, so an id can never introduce a path segment or a
 * traversal when it is interpolated into `/markets/${id}/` (Phase 3: path
 * injection / SSRF). The transport's SAFE_PATH/DOT_SEGMENT/origin checks are
 * the second layer.
 */
export const MARKET_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Wire time -> domain UnixSeconds. The live API mixes ISO strings and unix ints. */
function wireTimeToUnix(value: number | string): UnixSeconds {
  return typeof value === 'number' ? unixSeconds(value) : wireIsoToUnixSeconds(value);
}

/** Map a present wire price to a domain Price, or null if out of range. */
function priceOrNull(raw: string | null): Price | null {
  if (raw === null) return null;
  const parsed = priceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Map a validated wire market to the domain. Any throw (a bad id, a non-USDC
 * volume, a negative time) is caught and turned into a `malformed` failure, so
 * the catch is the rollback: no half-built Market escapes.
 */
export function toDomainMarket(
  wire: MarketWire,
): Result<Market, PantaTransportError> {
  try {
    return ok({
      marketId: marketIdSchema.parse(wire.marketId),
      category: wire.category,
      title: wire.title,
      description: wire.description,
      phase: wire.phase,
      volumeUsdc: usdcDecimalSchema.parse(wire.volumeUsdc),
      startTime: wireTimeToUnix(wire.startTime),
      endTime: wireTimeToUnix(wire.endTime),
      resolutionTime: wireTimeToUnix(wire.resolutionTime),
      resolved: wire.resolved,
      yesPrice: priceOrNull(wire.yesPrice),
      noPrice: priceOrNull(wire.noPrice),
    });
  } catch {
    return err({
      kind: 'malformed',
      message: 'a Panta market could not be mapped to the domain',
    });
  }
}

/** GET /categories/ -> the category allowlist as returned by Panta. */
export interface CategoriesReadResult {
  readonly categories: readonly string[];
  readonly disclaimer: string | null;
}

export async function fetchCategories(
  client: PantaClient,
): Promise<Result<CategoriesReadResult, PantaTransportError>> {
  const result = await client.request({
    method: 'GET',
    path: '/categories/',
    schema: categoriesResponseSchema,
  });
  if (!result.ok) return err(result.error);
  return ok({
    categories: result.value.categories,
    disclaimer: result.value.disclaimer ?? null,
  });
}

/** A page of markets plus the cursor for the next page. */
export interface MarketListResult {
  readonly markets: readonly Market[];
  readonly nextCursor: string | null;
  /** Sandbox notice when the API reports one; null means none was sent. */
  readonly disclaimer: string | null;
}

/** GET /markets/ -> a mapped page of markets. */
export async function fetchMarketList(
  client: PantaClient,
  query: Readonly<Record<string, string | number | undefined>>,
): Promise<Result<MarketListResult, PantaTransportError>> {
  const result = await client.request({
    method: 'GET',
    path: '/markets/',
    query,
    schema: marketListResponseSchema,
  });
  if (!result.ok) return err(result.error);

  const markets: Market[] = [];
  for (const wire of result.value.items) {
    const mapped = toDomainMarket(wire);
    // Fail the whole page on one unmappable item: a shape drift is systemic.
    if (!mapped.ok) return err(mapped.error);
    markets.push(mapped.value);
  }
  return ok({
    markets,
    nextCursor: result.value.nextCursor ?? null,
    disclaimer: result.value.disclaimer ?? null,
  });
}

/** A single market read. `market` is null when Panta reports 404. */
export interface MarketReadResult {
  readonly market: Market | null;
  readonly disclaimer: string | null;
}

/** GET /markets/{id}/ -> the mapped market, or null when Panta reports 404. */
export async function fetchMarket(
  client: PantaClient,
  id: string,
): Promise<Result<MarketReadResult, PantaTransportError>> {
  // Perimeter: an id that is not a plain slug is treated as "no such market"
  // and never reaches the network (Phase 3: path injection / enumeration).
  if (!MARKET_ID_PATTERN.test(id)) {
    return ok({ market: null, disclaimer: null });
  }
  const result = await client.request({
    method: 'GET',
    path: `/markets/${id}/`,
    schema: marketWireSchema,
  });
  if (!result.ok) {
    if (result.error.kind === 'http' && result.error.status === 404) {
      return ok({ market: null, disclaimer: null });
    }
    return err(result.error);
  }
  const mapped = toDomainMarket(result.value);
  if (!mapped.ok) return err(mapped.error);
  return ok({
    market: mapped.value,
    disclaimer: result.value.disclaimer ?? null,
  });
}
