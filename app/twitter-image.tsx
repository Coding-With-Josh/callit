/**
 * Root Twitter/X card image. Mirrors the Open Graph default so X does not fall
 * back to a bare link.
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
