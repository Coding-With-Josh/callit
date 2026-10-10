"use client";

import Lenis from "lenis";

// Single shared scroll driver for the whole app (Phase 3: double-init guard).
// React StrictMode double-mounts effects in dev and HMR re-runs them; every
// caller resolves to this one instance instead of spawning competing RAF
// loops that fight over window.scrollY.
let lenis: Lenis | null = null;
let rafId = 0;

const EASE = (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t));

export function initLenis(): boolean {
  if (typeof window === "undefined") return false;
  if (lenis) return true;
  try {
    lenis = new Lenis({
      duration: 1.15,
      easing: EASE,
      smoothWheel: true,
      // Touch stays native — smoothing touch fights native momentum and feels
      // janky on phones. Only wheel/scrollbar get the lerp.
      syncTouch: false,
    });
    const raf = (time: number) => {
      try {
        lenis?.raf(time);
      } catch {
        // Scroll math threw — fail OPEN to native scrolling rather than
        // stranding the page (Phase 3: stuck-scroll vector).
        destroyLenis();
        return;
      }
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);
    return true;
  } catch {
    // Constructor threw (unexpected runtime) — stay uninitialized; callers
    // fall back to native scroll.
    lenis = null;
    return false;
  }
}

export function destroyLenis() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  try {
    lenis?.destroy();
  } catch {
    // destroy is best-effort; the null-out below is the real contract.
  }
  lenis = null;
}

/** Expose the live instance (resize hooks re-measure after late layout). */
export function getLenis(): Lenis | null {
  return lenis;
}

/**
 * Scroll one of our sections into view — CENTERED in the viewport, not
 * pinned under the navbar (Phase 3: "Browse markets" must land mid-section).
 *
 * Works with or without Lenis: reduced-motion users and init-failure pages
 * get the identical centered landing, instantly. Never throws; no target ->
 * no-op.
 */
export function scrollToSection(selector: string) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const y = rect.top + window.scrollY;
  // Center: section middle lines up with viewport middle. Clamped so we
  // never scroll past the document bottom or above the top (Phase 3: clamp).
  const target = Math.min(
    Math.max(y - (window.innerHeight - rect.height) / 2, 0),
    Math.max(document.documentElement.scrollHeight - window.innerHeight, 0),
  );
  const reducedMotion =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (lenis) {
    lenis.scrollTo(target, { duration: 1.15, easing: EASE });
  } else {
    window.scrollTo({
      top: target,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  }
}

// Click handler for in-page section links (e.g. "Browse markets"). Only
// intercepts when the target exists on the current page — otherwise it lets
// the browser follow href (cross-page navigation to "/#browse"). Never leaves
// a click dead (Phase 3: cross-page anchor vector).
export function handleSectionLink(
  event: { preventDefault: () => void },
  selector: string,
) {
  if (typeof document === "undefined") return;
  if (!document.querySelector(selector)) return; // let href navigate
  event.preventDefault();
  try {
    scrollToSection(selector);
    // Shareable in-page anchor (replaceState so Back isn't polluted). Does
    // not itself scroll — Lenis already moved to the target.
    window.history.replaceState(
      null,
      "",
      selector.startsWith("#") ? selector : `#${selector}`,
    );
  } catch {
    window.location.hash = selector.startsWith("#")
      ? selector.slice(1)
      : selector;
  }
}