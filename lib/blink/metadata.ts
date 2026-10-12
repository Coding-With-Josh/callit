/**
 * blink/metadata — the Solana Actions `GET` response for a market.
 *
 * Owns: turning a loaded market into the exact `ActionGetResponse` a Blink
 * client renders (icon, title, description, buttons) — including the closed
 * preset buttons from `params`.
 * Must not import: React, Next, adapters, or any framework module.
 *
 * Compliance (README, build.md §4): the exact string `Powered by Panta` appears
 * in the description of every Blink, and a fixture/demo market is labelled as
 * such — never presented as live. An unknown/unavailable market returns a
 * disabled card with an honest reason rather than a broken one.
 *
 * Phase 3 (client-side length/char limits): the Actions spec caps title at 70,
 * description at 500 and label at 50. A market question can exceed all of those,
 * so every field is sanitized (control characters stripped) and hard-truncated
 * BEFORE it is returned — and then validated against `actionGetResponseSchema`,
 * so a malformed card fails closed at our boundary instead of at the client's.
 */
import {
  actionGetResponseSchema,
  PANTA_BADGE,
  type ActionGetResponse,
  type Market,
} from '@/types';
import { formatAsOf, percentFromPrice } from '@/lib/format';
import { absoluteUrl } from '@/lib/seo/site';
import type { MarketFixture } from '@/lib/market-fixtures';
import { BLINK_AMOUNTS_USDC, BLINK_SIDES, blinkActionHref } from './params';

/** Spec limits from the Solana Actions GET response. */
export const BLINK_TITLE_MAX = 70;
export const BLINK_DESCRIPTION_MAX = 500;
export const BLINK_LABEL_MAX = 50;

/**
 * Strip control characters and hard-truncate to `max` code units, appending an
 * ellipsis when shortened. Control characters are removed first because a
 * newline or NUL in a market title would otherwise reach a wallet client's
 * renderer (Phase 3: untrusted copy in a client UI).
 */
export function sanitizeCopy(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  const stripped = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripped.length <= max) return stripped;
  return `${stripped.slice(0, max - 1).trimEnd()}…`;
}

/** The separator between prose and the required badge. */
const BADGE_SEPARATOR = ' · ';

/**
 * Join prose with the required `Powered by Panta` badge so the badge SURVIVES
 * truncation.
 *
 * Phase 3 (compliance truncation): the badge is a hard requirement on every
 * Panta-powered surface, but every field here is capped by the Actions spec. The
 * earlier shape sanitized `parts.join()` as one string, so a long market title
 * could push the badge past the cap and silently cut it off — the one string we
 * are required to ship, removed by the same call that exists to bound the field.
 * Here the prose is truncated into the space LEFT by the badge, and the badge is
 * appended afterwards, so it can never be the part that is dropped.
 */
export function sanitizeCopyWithBadge(prose: string, max: number): string {
  const room = max - PANTA_BADGE.length - BADGE_SEPARATOR.length;
  if (room < 1) {
    // Degenerate cap (only reachable if a caller passes a tiny max): the badge
    // is the requirement, so it wins over the prose.
    return sanitizeCopy(PANTA_BADGE, max);
  }
  return `${sanitizeCopy(prose, room)}${BADGE_SEPARATOR}${PANTA_BADGE}`;
}

/** The title rendered by the client. Capped at the spec limit. */
function blinkTitle(market: Market): string {
  return sanitizeCopy(market.title, BLINK_TITLE_MAX);
}

/**
 * Odds line, or null when the market has no trustworthy price. A price is only
 * shown alongside its "as of" time (types/compliance: a DisplayPrice cannot be
 * built without one), so the two always travel together here.
 */
function oddsLine(fixture: MarketFixture): string | null {
  const { market, asOf } = fixture;
  if (market.yesPrice === null || market.noPrice === null) return null;
  const yes = percentFromPrice(market.yesPrice);
  const no = percentFromPrice(market.noPrice);
  return `YES ${yes}% · NO ${no}% (as of ${formatAsOf(asOf)})`;
}

/**
 * Why a card's buttons are disabled, and the honest label for it.
 *
 * A fixture is disabled FIRST: `market.phase` alone would say `primary` for
 * `demo-primary`, and the card would then advertise a buy button for a market
 * that has no on-chain existence — an action the POST refuses. Offering an
 * action we will refuse is itself the fail-open shape (Phase 3: demo-provenance
 * money path), so provenance is checked before phase.
 */
function disabledCopy(fixture: MarketFixture): { label: string; reason: string } {
  if (fixture.provenance === 'fixture') {
    return {
      label: 'Demo market only',
      reason: 'This is a demo market. No funds can move.',
    };
  }
  switch (fixture.market.phase) {
    case 'secondary':
      return {
        label: 'Trading closed',
        reason: 'This market has graduated to secondary trading and is read-only here.',
      };
    case 'resolved':
      return { label: 'Market resolved', reason: 'This market is resolved.' };
    case 'cancelled':
      return { label: 'Market cancelled', reason: 'This market was cancelled.' };
    default:
      return {
        label: 'Buying closed',
        reason: 'Primary buying is not open for this market.',
      };
  }
}

/**
 * Build the `GET` metadata for a loaded market.
 *
 * Total and fail-closed: it never throws, and the returned object is validated
 * against `actionGetResponseSchema` before it leaves this function. A fixture
 * market, or one in any phase other than `primary`, gets `disabled: true` and NO
 * `links.actions`, so a client cannot render a buy button for a market the POST
 * would refuse.
 */
export function buildActionMetadata(fixture: MarketFixture): ActionGetResponse {
  const { market, provenance, disclaimer } = fixture;
  // Both conditions, not phase alone: a fixture's phase is `primary` and it must
  // still never advertise a buy button (see `disabledCopy`).
  const isBuyable = market.phase === 'primary' && provenance !== 'fixture';

  const parts: string[] = [];
  if (provenance === 'fixture') {
    parts.push('Demo market, not live');
  }
  parts.push(market.category);
  const odds = oddsLine(fixture);
  if (odds !== null) parts.push(odds);
  if (!isBuyable) {
    parts.push(disabledCopy(fixture).reason);
  } else {
    parts.push('Back YES or NO with USDC. Fees are shown by your wallet before you sign.');
  }
  if (disclaimer !== null) parts.push(disclaimer);

  // The exact, required badge string is appended by `sanitizeCopyWithBadge`
  // AFTER the prose is truncated, so it always survives (Phase 3: truncation).
  const description = sanitizeCopyWithBadge(parts.join(' · '), BLINK_DESCRIPTION_MAX);

  const base = {
    type: 'action' as const,
    icon: absoluteUrl(`/markets/${encodeURIComponent(market.marketId)}/opengraph-image`),
    title: blinkTitle(market),
    description,
  };

  if (!isBuyable) {
    return actionGetResponseSchema.parse({
      ...base,
      label: sanitizeCopy(disabledCopy(fixture).label, BLINK_LABEL_MAX),
      disabled: true,
    });
  }

  // Preset buttons: one per (side × amount). The spec says a user should
  // perform only ONE of the listed actions, which is exactly this shape.
  const actions = BLINK_SIDES.flatMap((side) =>
    BLINK_AMOUNTS_USDC.map((amount) => ({
      type: 'transaction' as const,
      href: blinkActionHref(market.marketId, side, amount),
      label: sanitizeCopy(
        `Back ${side.toUpperCase()} ${amount} USDC`,
        BLINK_LABEL_MAX,
      ),
    })),
  );

  return actionGetResponseSchema.parse({
    ...base,
    label: sanitizeCopy('Back a side', BLINK_LABEL_MAX),
    links: { actions },
  });
}
