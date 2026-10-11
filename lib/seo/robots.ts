/**
 * seo/robots — the two `robots` metadata directives every route picks from.
 *
 * Centralised so "indexable" and "not indexable" cannot drift between routes
 * (Phase 3: index-state injection). The default is the fail-closed directive:
 * a route must positively opt in to indexing.
 */
import type { Metadata } from 'next';

/** Positively indexable. Set only where the content is a real, public document. */
export const INDEXABLE_ROBOTS: Metadata['robots'] = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  },
};

/**
 * Fail-closed directive for fixture/demo/sandbox content and non-document
 * routes. `follow: true` so link equity still flows out of a noindexed page.
 */
export const NOINDEX_ROBOTS: Metadata['robots'] = {
  index: false,
  follow: true,
  googleBot: { index: false, follow: true },
};
