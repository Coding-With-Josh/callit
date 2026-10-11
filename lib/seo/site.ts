/**
 * seo/site — the single source of truth for canonical origin, name and copy
 * used by every metadata surface (layout, per-route metadata, robots, sitemap,
 * manifest, JSON-LD, OG images).
 *
 * Owns: the canonical origin and the shared site strings. Centralising the
 * origin is what stops a canonical/OG URL from being hand-typed differently in
 * two places (Phase 3: duplicate-content / canonical drift).
 * Must not import: React, Next, or any UI module.
 */

/**
 * The production origin. `NEXT_PUBLIC_APP_URL` wins when set (Vercel prod sets
 * it); the literal is the fallback so a missing env never yields a `localhost`
 * canonical (Phase 2: fail-safe default).
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? 'https://callit-market.vercel.app'
).replace(/\/+$/, '');

export const SITE = {
  name: 'callit',
  /** Absolute origin, no trailing slash. */
  url: SITE_URL,
  /** One-line positioning used as the default meta description / OG copy. */
  tagline: 'Call it. Back it.',
  description:
    'Turn any claim into a tradable YES/NO prediction market, share it as a link or a Solana Blink, and back a side in a tap.',
  /** Social profiles, used for the Organization JSON-LD `sameAs` and footer. */
  socials: {
    x: 'https://x.com/call_it',
    github: 'https://github.com/Coding-With-Josh/callit',
  },
} as const;

/** Absolute URL for a site-relative path. `path` may be "" or "/x". */
export function absoluteUrl(path = ''): string {
  if (path === '' || path === '/') return `${SITE.url}/`;
  return `${SITE.url}${path.startsWith('/') ? '' : '/'}${path}`;
}
