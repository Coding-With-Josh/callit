/**
 * Per-market Open Graph image. Dynamic: it renders the market's own title and
 * live odds so a shared market link is self-describing in a timeline.
 *
 * Phase 2/3: an unknown or upstream-unavailable id (loadMarketCached -> null)
 * must still return a valid brand image — never a throw, never a broken card.
 * A resolved market with a null price simply omits the odds pill.
 */
import { loadMarketCached } from '@/lib/panta/catalog-cache';
import { percentFromPrice } from '@/lib/format';
import { ogImage } from '@/lib/seo/og';

export const alt = 'A live prediction market on callit';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type ImageProps = { params: Promise<{ id: string }> };

export default async function Image({ params }: ImageProps) {
  const { id } = await params;
  const fixture = await loadMarketCached(id);

  if (!fixture) {
    return ogImage({
      eyebrow: 'Market',
      title: 'Call it. Back it.',
      subtitle: 'Prediction markets, priced and settled by Panta.',
    });
  }

  const { market } = fixture;
  return ogImage({
    eyebrow: market.category,
    title: market.title,
    yes: market.yesPrice ? percentFromPrice(market.yesPrice) : null,
    no: market.noPrice ? percentFromPrice(market.noPrice) : null,
  });
}
