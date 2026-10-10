import { Search } from "lucide-react";
import React from "react";

// Placeholder categories until real data lands — structure only, no cards yet.
const FILTERS = ["All", "Trending", "New", "Crypto", "Sports", "Politics", "Culture"] as const;

export const Browse = () => {
  return (
    <section
      id="browse"
      className="w-full max-w-6xl mx-auto px-6 md:px-12 py-20 md:py-24 h-[90vh] scroll-mt-24"
    >
      {/* Two-column layout: LEFT = heading + subtitle + filter chips (stacked).
          RIGHT = search bar + results area. Stacks on mobile. */}
      <div className="flex flex-col gap-10 md:flex-row md:gap-12">
        {/* ---- LEFT column: heading, subtitle, filters ---- */}
        <div className="flex flex-col md:w-72 lg:w-80 md:shrink-0">
          <h2 className="text-3xl md:text-4xl font-tusker-9800 text-[#2D1C00]">
            Browse markets
          </h2>
          <p className="mt-2 text-sm font-medium md:text-base font-sans text-[#2D1C00]/70 tracking-tight max-w-md">
            Find a claim worth taking a side on — every market here is tradable in a tap.
          </p>

          {/* Filter chips — row (wrapping) on mobile, vertical column from md+,
              left-aligned with the heading. Active chip mirrors the hero primary
              button; the rest mirror the secondary one. */}
          <div className="mt-6 md:mt-8 flex flex-row flex-wrap items-start gap-3 md:flex-col md:gap-4">
            {FILTERS.map((label) => {
              const active = label === "All";
              return (
                <button
                  key={label}
                  className={`py-2.5 px-6 tracking-tight font-medium flex items-center justify-center rounded-full hover:scale-102 active:scale-98 transition-all cursor-pointer ${
                    active
                      ? "bg-[#2D1C00] text-white"
                      : "bg-[#2D1C00]/20 text-[#2D1C00]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ---- RIGHT column: search bar on top, results area below ---- */}
        <div className="flex flex-1 flex-col gap-6 min-w-0">
          {/* Search bar */}
          <div className="relative w-full">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 size-4 text-[#2D1C00]/50"
              strokeWidth={2.5}
            />
            <input
              type="search"
              placeholder="Search markets"
              aria-label="Search markets"
              className="w-full min-w-0 rounded-full bg-[#2D1C00]/10 py-3 pl-11 pr-4 font-sans text-sm md:text-base text-[#2D1C00] placeholder:text-[#2D1C00]/50 outline-none ring-1 ring-[#2D1C00]/15 transition focus:ring-2 focus:ring-[#2D1C00]/30"
            />
          </div>

          {/* Results area — reserved space for the market cards. Structure only:
              no data or cards yet, so a dashed placeholder marks the region. */}
          <div className="flex flex-1 min-h-64 items-center justify-center rounded-2xl border-2 border-dashed border-[#2D1C00]/15 bg-[#2D1C00]/10 p-8">
            <p className="text-sm font-sans tracking-tight text-[#2D1C00]/40">
              Market cards will render here.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}