/**
 * manifest.webmanifest — PWA metadata (name, colors, icon) so the site installs
 * cleanly and browsers can theme the address bar / home-screen entry.
 */
import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#2D1C00',
    theme_color: '#FFF2DD',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
