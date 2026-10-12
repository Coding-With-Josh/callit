"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { PantaBadge } from "@/components/market/panta-badge";
import { formatUsdcCompact, percentFromPrice } from "@/lib/format";
import type { MarketFixture } from "@/lib/market-fixtures";
import { MARKET_PHASES, type DataProvenance, type MarketPhase } from "@/types";

const PHASE_LABELS: Record<MarketPhase, string> = {
  primary: "Open",
  secondary: "Graduated",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

/** "crypto" -> "Crypto" for a chip label; the filter value stays the raw slug. */
const titleCase = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1);

/** How the filtered list is ordered. Volume is the default (BigInt, no floats). */
type SortKey = "volume" | "closing" | "newest";

const SORT_KEYS: readonly SortKey[] = ["volume", "closing", "newest"];

const SORT_LABELS: Record<SortKey, string> = {
  volume: "Highest volume",
  closing: "Closing soonest",
  newest: "Newest",
};

/** Rows revealed on first paint and on each "Load more" press. */
const PAGE_SIZE = 12;

/**
 * Compare two USDC decimal strings DESCENDING without float conversion: whole
 * units as BigInt, then the zero-padded 6-decimal fractions as strings. Ordering
 * only — never used to compute a displayed number.
 */
const compareUsdcDesc = (a: string, b: string): number => {
  const [aw = "0", af = ""] = a.split(".");
  const [bw = "0", bf = ""] = b.split(".");
  const wa = BigInt(aw);
  const wb = BigInt(bw);
  if (wa !== wb) return wa > wb ? -1 : 1;
  const fa = `${af}000000`.slice(0, 6);
  const fb = `${bf}000000`.slice(0, 6);
  if (fa === fb) return 0;
  return fa > fb ? -1 : 1;
};

/**
 * Deterministic ordering. `Array.prototype.sort` is stable, but a title tiebreak
 * makes the order identical across re-renders even when two markets share a
 * volume/time — no visible reshuffle on an unrelated state change.
 */
const compareMarkets = (
  a: MarketFixture,
  b: MarketFixture,
  sort: SortKey,
): number => {
  const A = a.market;
  const B = b.market;
  const primary =
    sort === "volume"
      ? compareUsdcDesc(A.volumeUsdc, B.volumeUsdc)
      : sort === "closing"
        ? A.endTime - B.endTime
        : B.startTime - A.startTime;
  return primary !== 0 ? primary : A.title.localeCompare(B.title);
};

type PhaseFilter = "all" | MarketPhase;
type CategoryFilter = "all" | string;

interface BrowseExplorerProps {
  readonly items: readonly MarketFixture[];
  readonly provenance: DataProvenance;
  readonly disclaimer: string | null;
}

/**
 * The interactive Browse body — one client island that owns search, the category
 * AND phase filters, the sort order, and the client-side page window. The list
 * itself comes from the RSC (there is no client fetch of the catalog), so the
 * Panta key never reaches the browser and "Load more" spends no extra read.
 *
 * Every value rendered is upstream market text placed as a React child (escaped);
 * no `dangerouslySetInnerHTML`, and no `href` is ever built from market data.
 */
export const BrowseExplorer = ({
  items,
  provenance,
  disclaimer,
}: BrowseExplorerProps) => {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [sort, setSort] = useState<SortKey>("volume");
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Every filter change resets the window to the first page IN THE SAME handler,
  // so "Load more" can never leave the user deep inside a list whose top they can
  // no longer reason about. Done here rather than in an effect: a synchronous
  // setState inside an effect triggers a cascading second render.
  const changeQuery = (value: string) => {
    setQuery(value);
    setVisible(PAGE_SIZE);
  };
  const changeCategory = (value: CategoryFilter) => {
    setCategory(value);
    setVisible(PAGE_SIZE);
  };
  const changePhase = (value: PhaseFilter) => {
    setPhase(value);
    setVisible(PAGE_SIZE);
  };
  const changeSort = (value: SortKey) => {
    setSort(value);
    setVisible(PAGE_SIZE);
  };

  // Filter chips are derived from the data actually present, so a chip can never
  // select a value with no rows behind it (no dead-end filters).
  const categories = useMemo(() => {
    const unique = new Set(items.map((item) => item.market.category));
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const phases = useMemo(() => {
    const present = new Set(items.map((item) => item.market.phase));
    return MARKET_PHASES.filter((value) => present.has(value));
  }, [items]);

  const needle = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    const matched = items.filter((item) => {
      const { market } = item;
      if (category !== "all" && market.category !== category) return false;
      if (phase !== "all" && market.phase !== phase) return false;
      if (needle === "") return true;
      // Search the whole public record, not just the title.
      return `${market.title} ${market.category} ${market.description}`
        .toLowerCase()
        .includes(needle);
    });
    return [...matched].sort((a, b) => compareMarkets(a, b, sort));
  }, [items, category, phase, needle, sort]);

  const shown = filtered.slice(0, visible);
  const hasMore = filtered.length > shown.length;
  const clearFilters = () => {
    setQuery("");
    setCategory("all");
    setPhase("all");
    setVisible(PAGE_SIZE);
  };

  return (
    <div className="flex flex-col gap-10 md:flex-row md:gap-12">
      {/* ---- LEFT column: heading, subtitle, filters ---- */}
      <div className="flex flex-col gap-7 md:w-72 lg:w-80 md:shrink-0">
        <div>
          <h2 className="text-3xl md:text-4xl font-tusker-9800 text-[#2D1C00]">
            Browse markets
          </h2>
          <p className="mt-2 text-sm font-medium md:text-base font-sans text-[#2D1C00]/70 tracking-tight max-w-md">
            Find a claim worth taking a side on — every market here is tradable in
            a tap.
          </p>
        </div>

        {categories.length > 0 && (
          <FilterGroup label="Category">
            <FilterChip
              label="All"
              active={category === "all"}
              onClick={() => changeCategory("all")}
            />
            {categories.map((value) => (
              <FilterChip
                key={value}
                label={titleCase(value)}
                active={category === value}
                onClick={() => changeCategory(value)}
              />
            ))}
          </FilterGroup>
        )}

        {phases.length > 0 && (
          <FilterGroup label="Phase">
            <FilterChip
              label="All"
              active={phase === "all"}
              onClick={() => changePhase("all")}
            />
            {phases.map((value) => (
              <FilterChip
                key={value}
                label={PHASE_LABELS[value]}
                active={phase === value}
                onClick={() => changePhase(value)}
              />
            ))}
          </FilterGroup>
        )}

        <FilterGroup label="Sort">
          {SORT_KEYS.map((value) => (
            <FilterChip
              key={value}
              label={SORT_LABELS[value]}
              active={sort === value}
              onClick={() => changeSort(value)}
            />
          ))}
        </FilterGroup>
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
            onChange={(event) => changeQuery(event.target.value)}
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
              <NoMatches onClear={clearFilters} />
            ) : (
              <>
                <ol className="mt-3 flex flex-col border-t border-[#2D1C00]/10">
                  {shown.map((fixture) => (
                    <MarketRow key={fixture.market.marketId} fixture={fixture} />
                  ))}
                </ol>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] tracking-tight text-[#2D1C00]/40">
                    Showing {shown.length} of {filtered.length}
                  </span>
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => setVisible((value) => value + PAGE_SIZE)}
                      className="cursor-pointer rounded-full bg-[#2D1C00]/10 px-4 py-1.5 font-mono text-[11px] uppercase tracking-tight text-[#2D1C00]/70 transition-colors hover:bg-[#2D1C00]/20"
                    >
                      Load more
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** A labelled group of filter chips: wrapping row on mobile, column from md+. */
const FilterGroup = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div>
    <p className="font-tusker-6700 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#2D1C00]/40">
      {label}
    </p>
    <div className="mt-2 flex flex-row flex-wrap items-start gap-3 md:flex-col md:gap-2.5">
      {children}
    </div>
  </div>
);

/** One filter/sort chip. Active mirrors the hero primary button. */
const FilterChip = ({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    className={`py-2.5 px-6 tracking-tight font-medium flex items-center justify-center rounded-full hover:scale-102 active:scale-98 transition-all cursor-pointer ${
      active ? "bg-[#2D1C00] text-white" : "bg-[#2D1C00]/20 text-[#2D1C00]"
    }`}
  >
    {label}
  </button>
);

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
            {formatUsdcCompact(market.volumeUsdc)} vol
          </p>
        </div>
      </Link>
    </li>
  );
};

/** The filtered-to-empty state. Owns its own recovery action. */
const NoMatches = ({ onClear }: { onClear: () => void }) => (
  <div className="mt-3 flex flex-1 min-h-40 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-[#2D1C00]/15 p-8">
    <p className="text-sm font-sans tracking-tight text-[#2D1C00]/40">
      No markets match your filters.
    </p>
    <button
      type="button"
      onClick={onClear}
      className="cursor-pointer rounded-full bg-[#2D1C00]/10 px-4 py-1.5 font-mono text-[11px] uppercase tracking-tight text-[#2D1C00]/60 transition-colors hover:bg-[#2D1C00]/20"
    >
      Clear filters
    </button>
  </div>
);

const ResultsPlaceholder = ({ message }: { message: string }) => (
  <div className="flex flex-1 min-h-64 items-center justify-center rounded-2xl border-2 border-dashed border-[#2D1C00]/15 bg-[#2D1C00]/10 p-8">
    <p className="text-sm font-sans tracking-tight text-[#2D1C00]/40">
      {message}
    </p>
  </div>
);
