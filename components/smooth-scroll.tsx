"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  destroyLenis,
  getLenis,
  initLenis,
  scrollToSection,
} from "@/lib/lenis";

/**
 * Global smooth-scroll driver, mounted once in the root layout. Owns the
 * Lenis lifecycle + the cross-page "#browse" landing; the hero/navbar
 * "Browse markets" controls just call scrollToSection() on the singleton.
 */
export const SmoothScroll = () => {
  const pathname = usePathname();

  // Lenis lifecycle — one instance for the whole app, alive for the layout's
  // lifetime (survives route changes). Reduced-motion users never get Lenis
  // (Phase 2 degraded fallback); scrollToSection then jumps instantly.
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    initLenis();
    return () => destroyLenis();
  }, []);

  // Keep Lenis's internal scroll limit in sync with the REAL content height.
  // Font swaps, streamed RSC sections and late images all grow the page after
  // init; without a re-measure, wheel scrolling dead-ends above the true
  // bottom (Phase 3: "stuck scroll"). Fail-open: a throwing resize never
  // breaks the page.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      try {
        getLenis()?.resize();
      } catch {
        // Advisory re-measure; native scroll still works without it.
      }
    });
    if (document.body) ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  // Cross-page "Browse markets" (href="/#browse" from the market page): Next
  // navigates with scroll disabled, then this effect centers #browse once the
  // target exists — with or without Lenis. Also re-measures limits after the
  // route's content settles. Never scrolls when there is no hash, and a
  // missing target is a no-op (Phase 3: hash poisoning).
  useEffect(() => {
    // New route may have different content height -> refresh Lenis limits
    // before any scroll math (Phase 3: stale-limit vector).
    try {
      getLenis()?.resize();
    } catch {
      // ignore
    }
    const hash = window.location.hash;
    if (!hash) return;
    let cancelled = false;
    const go = () => {
      if (!cancelled) scrollToSection(hash);
    };
    const raf = requestAnimationFrame(go);
    // Re-center after fonts/layout settle — height changes shift the center
    // calculation; the delta is a few px, so the second animation is
    // imperceptible (Phase 3: double-animation check).
    const timer = window.setTimeout(go, 350);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [pathname]);

  return null;
};