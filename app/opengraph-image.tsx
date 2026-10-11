/**
 * Root Open Graph image. Site-wide default; per-market shares get their own
 * dynamic image at app/markets/[id]/opengraph-image.tsx.
 */
import { ogImage } from '@/lib/seo/og';
import { SITE } from '@/lib/seo/site';

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return ogImage({
    eyebrow: 'Prediction markets',
    title: SITE.tagline,
    subtitle: SITE.description,
  });
}
