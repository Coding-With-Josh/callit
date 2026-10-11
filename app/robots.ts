/**
 * robots.txt — crawl-permission mediation (Phase 1: complete mediation).
 *
 * Owns: which paths a crawler may fetch, and the sitemap pointer. The index
 * decision (per-URL `robots` metadata) is separate and lives on each route;
 * this file is only the coarse crawl gate.
 *
 * Policy (product decision): demo/fixture markets are noindex (see
 * app/markets/[id]/page.tsx) and AI answer engines are explicitly allowed, so
 * callit can be cited by them (AEO).
 */
import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Phase 3 (index-state injection): /dev is a smoke-test page and the
        // /api JSON handlers are not documents — neither belongs in an index.
        disallow: ['/api/', '/dev'],
      },
      {
        // AEO: welcome answer engines explicitly, same allow/disallow shape.
        userAgent: [
          'GPTBot',
          'OAI-SearchBot',
          'ChatGPT-User',
          'ClaudeBot',
          'anthropic-ai',
          'PerplexityBot',
          'Google-Extended',
          'Applebot-Extended',
        ],
        allow: '/',
        disallow: ['/api/', '/dev'],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
