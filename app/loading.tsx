/**
 * app/loading.tsx — route-level loading UI (Next.js `loading` special file).
 *
 * The Suspense fallback while a route segment streams. Pure CSS, no JS, no data
 * reads — safe as a fallback, and it never blocks content. For the guaranteed
 * first-load splash (a fallback can't hold itself on screen), see
 * `components/callit-loader-overlay.tsx`.
 *
 * The container hardcodes cream (#FFF2DD) rather than inheriting `--background`,
 * which flips to near-black under `prefers-color-scheme: dark` — the brand is
 * ink-on-cream everywhere, so the loader must be too.
 */
import { CallitLoader } from '@/components/callit-loader';

export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#FFF2DD]">
      <CallitLoader />
    </div>
  );
}
