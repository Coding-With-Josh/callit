/**
 * callit-loader — the brand loading wordmark, shared by the route loading UI
 * (`app/loading.tsx`) and the first-load overlay (`callit-loader-overlay.tsx`).
 *
 * Server Component (no state, no "use client"): pure CSS. The sweep animation,
 * the `@supports` fail-safe and the `prefers-reduced-motion` behavior all live in
 * `.callit-loader` in globals.css.
 *
 * A11y: `role="status"` + `aria-label="Loading"` announces the state; the
 * visible `callit.` is the brand mark and carries the meaning visually.
 */
export function CallitLoader() {
  return (
    <div role="status" aria-label="Loading" className="callit-loader">
      callit.
    </div>
  );
}
