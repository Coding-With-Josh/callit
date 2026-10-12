'use client';

/**
 * callit-loader-overlay — first-load splash.
 *
 * Why this exists: the route `loading.tsx` fallback is unmounted the instant its
 * segment streams, so it can never guarantee any on-screen time — on a fast load
 * it flashes by. This overlay owns its own lifetime: it mounts visible and is
 * removed after MIN_VISIBLE_MS, so the loader is actually seen once per load.
 *
 * Fail-safe (Phase 2): the CSS rule `.callit-boot-overlay` ALSO hides the
 * overlay on a timer, so a page whose JS never hydrates can never be trapped
 * under a permanent full-screen cover. The `setTimeout` below is cleanup that
 * takes the node out of the DOM; it is not what makes the cover disappear.
 */
import { useEffect, useState } from 'react';
import { CallitLoader } from './callit-loader';

/** How long the splash stays up (ms). Tune here. Must be >= the CSS timer. */
export const MIN_VISIBLE_MS = 4000;

export function CallitLoaderOverlay() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), MIN_VISIBLE_MS);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    // z-[90]: above the navbar (z-40) but BELOW the auth modal (z-[100]), so a
    // user who opens "Connect" during the splash is never covered by it.
    <div className="callit-boot-overlay fixed inset-0 z-[90] flex items-center justify-center bg-[#FFF2DD]">
      <CallitLoader />
    </div>
  );
}
