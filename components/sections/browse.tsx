import { Suspense } from "react";
import { loadMarketListing } from "@/lib/panta/catalog";
import { BrowseExplorer } from "./browse-explorer";

/**
 * One upstream page per Browse view either way, so ask for the API's single-page
 * max. Many live markets are untitled (filtered out in the client), so the
 * default 24 leaves too little to browse. NOTE: this is still a single page —
 * the catalog has a `nextCursor` that is not yet plumbed through.
 */
const BROWSE_LIMIT = 50;

/**
 * The Browse surface. The section shell is static; the live market list streams
 * in from a Suspense boundary, so the landing stays prerenderable and the Panta
 * key never leaves the server. The interactive search + category filter live in
 * one client island (BrowseExplorer) over the server-fetched list.
 */
export const Browse = () => {
  return (
    <section
      id="browse"
      className="w-full max-w-6xl mx-auto px-6 md:px-12 py-20 md:py-24 min-h-[90vh] scroll-mt-24"
    >
      <Suspense fallback={<BrowseFallback />}>
        <BrowseData />
      </Suspense>
    </section>
  );
};

const BrowseData = async () => {
  const listing = await loadMarketListing(BROWSE_LIMIT);
  return (
    <BrowseExplorer
      items={listing.items}
      provenance={listing.provenance}
      disclaimer={listing.disclaimer}
    />
  );
};

/** Approximates the two-column body so the streamed swap doesn't shift layout. */
const BrowseFallback = () => (
  <div className="flex flex-col gap-10 md:flex-row md:gap-12">
    <div className="flex flex-col md:w-72 lg:w-80 md:shrink-0">
      <h2 className="text-3xl md:text-4xl font-tusker-9800 text-[#2D1C00]">
        Browse markets
      </h2>
      <p className="mt-2 text-sm font-medium md:text-base font-sans text-[#2D1C00]/70 tracking-tight max-w-md">
        Find a claim worth taking a side on — every market here is tradable in a tap.
      </p>
    </div>
    <div className="flex flex-1 flex-col gap-6 min-w-0">
      <div className="h-11 w-full rounded-full bg-[#2D1C00]/10" />
      <div className="flex flex-1 min-h-64 items-center justify-center rounded-2xl border-2 border-dashed border-[#2D1C00]/15 bg-[#2D1C00]/10 p-8">
        <p className="text-sm font-sans tracking-tight text-[#2D1C00]/40">
          Loading markets…
        </p>
      </div>
    </div>
  </div>
);
