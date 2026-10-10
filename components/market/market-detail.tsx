import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { type MarketFixture } from "@/lib/market-fixtures";
import { formatUnixDate, formatUsdc } from "@/lib/format";
import { type Market, type MarketPhase } from "@/types";
import { PantaBadge } from "./panta-badge";
import { TradeDeck } from "./trade-deck";

/**
 * The hosted market surface. Server component: the editorial shell (header,
 * meta hairline row, resolution section) renders without JS; the trading
 * surface is one client island (TradeDeck) that owns side selection and the
 * phase guard.
 */
export const MarketDetail = ({ fixture }: { fixture: MarketFixture }) => {
  const { market, asOf: readAt, provenance } = fixture;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 pt-28 pb-24 md:px-12">
      <Link
        href="/#browse"
        className="inline-flex items-center gap-1.5 text-md font-medium tracking-tight text-[#2D1C00]/50 transition-colors hover:text-[#2D1C00]"
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.5} />
        All markets
      </Link>

      <header className="mt-8 max-w-3xl">
        <div className="flex items-center justify-start gap-3">
          <div className="flex items-center justify-center rounded-full px-3 py-1 bg-[#2D1C00]">
            <p className="text-xs font-semibold tracking-tight text-[#FFF2DD]">
              {PHASE_LABELS[market.phase]}
            </p>
          </div>
          <div className="flex items-center justify-center rounded-full px-3 py-1 bg-[#2D1C00]/10">
            <p className="text-xs font-semibold tracking-tight text-[#2D1C00]">
              {market.category}
            </p>
          </div>
        </div>

        <h1 className="mt-5 font-tusker-9800 text-4xl leading-[1.1] md:leading-[1.02] tracking-tight text-[#2D1C00] md:text-5xl">
          {/* Text child: React escapes — never dangerouslySetInnerHTML on
              market copy (Phase 3: XSS vector). */}
          {market.title}
        </h1>
        <p className="mt-4 text-sm font-medium leading-relaxed tracking-tight text-[#2D1C00]/70 md:text-base">
          {market.description}
        </p>
        <div className="mt-5">
          <PantaBadge />
        </div>
      </header>

      <div className="mt-10">
        <TradeDeck market={market} readAt={readAt} provenance={provenance} />
      </div>

      <MarketMeta market={market} />
      <ResolutionRules />
    </div>
  );
};

const PHASE_LABELS: Record<MarketPhase, string> = {
  primary: "Open",
  secondary: "Graduated",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

/** A single hairline-separated row — facts as typography, not a card. */
const MarketMeta = ({ market }: { market: Market }) => (
  <dl
    aria-label="Market facts"
    className="mt-18 grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4"
  >
    <MetaItem label="Open since" value={formatUnixDate(market.startTime)} />
    <MetaItem label="Closes" value={formatUnixDate(market.endTime)} />
    <MetaItem label="Resolves" value={formatUnixDate(market.resolutionTime)} />
    <MetaItem label="Volume" value={formatUsdc(market.volumeUsdc)} />
  </dl>
);

const MetaItem = ({ label, value }: { label: string; value: string }) => (
  <div className="sm:border-l sm:border-[#2D1C00]/10 sm:pl-5 sm:first:border-l-0 sm:first:pl-0">
    <dt className="font-tusker-6700 text-sm font-semibold text-[#2D1C00]/45">
      {label}
    </dt>
    <dd className="mt-1 text-sm font-semibold tracking-tight text-[#2D1C00]">
      {value}
    </dd>
  </div>
);

/** Editorial resolution section — honest placeholder, no dashed box. */
const ResolutionRules = () => (
  <section
    aria-label="Resolution rules"
    className="mt-14 max-w-3xl border-l-2 border-[#2D1C00]/15 pl-6"
  >
    <h2 className="font-tusker-9800 text-2xl tracking-tight text-[#2D1C00]">
      How does this resolve?
    </h2>
    <p className="mt-3 text-md font-semibold leading-relaxed tracking-tight text-[#2D1C00]/70">
      Resolution is determined by Panta&apos;s oracle.
    </p>
    <p className="mt-2 font-mono font-medium text-[11px] tracking-tight text-[#2D1C00]/45">
      Full rules and sources of truth appear here once the market detail API is
      wired.
    </p>
  </section>
);
