"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PantaBadge } from "@/components/market/panta-badge";
import { formatUsdc, percentFromPrice } from "@/lib/format";
import type { MarketFixture } from "@/lib/market-fixtures";
import type { DataProvenance, MarketPhase } from "@/types";

const PHASE_LABELS: Record<MarketPhase, string> = {
  primary: "Open",
  secondary: "Graduated",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

/** "crypto" -> "Crypto" for a chip label; the filter value stays the raw slug. */
const titleCase = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

interface BrowseExplorerProps {
  readonly items: readonly MarketFixture[];
  readonly provenance: DataProvenance;
  readonly disclaimer: string | null;
}

/**
 * The interactive Browse body — one client island that owns search + the
 * category filter over the server-fetched list. The list itself comes from the
 * RSC (there is no client fetch of the catalog), so the Panta key never reaches
 * the browser.
 */
export const BrowseExplorer = ({
  items,
  provenance,
  disclaimer,
}: BrowseExplorerProps) => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  // Filter chips are derived from the data actually present, so a chip can
  // never select a category with no rows behind it.
  const categories = useMemo(() => {
    const unique = new Set(items.map((item) => item.market.category));
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const needle = query.trim().toLowerCase();
  const filtered = items.filter((item) => {
    const matchesCategory =
      category === "all" || item.market.category === category;
    const matchesQuery =
      needle === "" || item.market.title.toLowerCase().includes(needle);
    return matchesCategory && matchesQuery;
  });

  const filters = ["all", ...categories];

  return (
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
          {filters.map((value) => {
            const active = value === category;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(value)}
                className={`py-2.5 px-6 tracking-tight font-medium flex items-center justify-center rounded-full hover:scale-102 active:scale-98 transition-all cursor-pointer ${
                  active
                    ? "bg-[#2D1C00] text-white"
                    : "bg-[#2D1C00]/20 text-[#2D1C00]"
                }`}
              >
                {value === "all" ? "All" : titleCase(value)}
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
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search markets"
            aria-label="Search markets"
            className="w-full min-w-0 rounded-full bg-[#2D1C00]/10 py-3 pl-11 pr-4 font-sans text-sm md:text-base text-[#2D1C00] placeholder:text-[#2D1C00]/50 outline-none ring-1 ring-[#2D1C00]/15 transition focus:ring-2 focus:ring-[#2D1C00]/30"
          />
        </div>

        {items.length === 0 ? (
          <ResultsPlaceholder message="No markets are live right now." />
        ) : (
          <div className="flex flex-1 flex-col min-w-0">
            <div className="flex items-center justify-between gap-3">
              <span className="font-tusker-6700 text-[11px] font-medium uppercase tracking-[0.2em] text-[#2D1C00]/40">
                {provenance === "live" ? "Live" : "Preview data · not live"}
              </span>
              <PantaBadge />
            </div>

            {disclaimer && (
              <p className="mt-3 rounded-xl bg-[#2D1C00]/5 px-3 py-2 font-mono text-[11px] leading-relaxed tracking-tight text-[#2D1C00]/55">
                {disclaimer}
              </p>
            )}

            {filtered.length === 0 ? (
              <div className="mt-3 flex flex-1 min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#2D1C00]/15 p-8">
                <p className="text-sm font-sans tracking-tight text-[#2D1C00]/40">
                  No markets match your filters.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                  }}
                  className="cursor-pointer rounded-full bg-[#2D1C00]/10 px-4 py-1.5 font-mono text-[11px] uppercase tracking-tight text-[#2D1C00]/60 transition-colors hover:bg-[#2D1C00]/20"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <ol className="mt-3 flex flex-col border-t border-[#2D1C00]/10">
                {filtered.map((fixture) => (
                  <MarketRow key={fixture.market.marketId} fixture={fixture} />
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** One editorial row — facts as typography, no card stack. */
const MarketRow = ({ fixture }: { fixture: MarketFixture }) => {
  const { market, provenance } = fixture;
  const yes = market.yesPrice ? percentFromPrice(market.yesPrice) : null;

  return (
    <li className="border-b border-[#2D1C00]/10">
      <Link
        href={`/markets/${market.marketId}`}
        className="group flex items-center gap-4 py-4 transition-colors hover:bg-[#2D1C00]/[0.03]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-tusker-6700 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#2D1C00]/45">
            <span>{PHASE_LABELS[market.phase]}</span>
            <span aria-hidden="true">·</span>
            <span>{market.category}</span>
          </div>
          {/* Text child: React escapes — never dangerouslySetInnerHTML on
              market copy (Phase 3: XSS vector). */}
          <p className="mt-1 truncate font-sans text-sm font-medium tracking-tight text-[#2D1C00] md:text-base">
            {market.title}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {yes ? (
            <p className="font-tusker-9800 text-2xl leading-none tracking-tight text-[#2D1C00]">
              {yes}
              <span className="align-top text-sm text-[#2D1C00]/45">%</span>
            </p>
          ) : (
            <p className="font-tusker-9800 text-2xl leading-none tracking-tight text-[#2D1C00]/30">
              —
            </p>
          )}
          <p className="mt-1 font-mono text-[10px] tracking-tight text-[#2D1C00]/40">
            {provenance === "fixture" ? "preview" : "live"} ·{" "}
            {formatUsdc(market.volumeUsdc)} vol
          </p>
        </div>
      </Link>
    </li>
  );
};

const ResultsPlaceholder = ({ message }: { message: string }) => (
  <div className="flex flex-1 min-h-64 items-center justify-center rounded-2xl border-2 border-dashed border-[#2D1C00]/15 bg-[#2D1C00]/10 p-8">
    <p className="text-sm font-sans tracking-tight text-[#2D1C00]/40">
      {message}
    </p>
  </div>
);
