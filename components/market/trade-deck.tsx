"use client";

import { ArrowUpRightFromSquare } from "lucide-react";
import { useState } from "react";
import { usePrivyGate } from "@/components/auth/use-privy-gate";
import {
  displayPrice,
  feeDisclosure,
  requirePrimaryMarket,
  SIDES,
  usdcDecimalSchema,
  type AsOf,
  type DataProvenance,
  type DisplayPrice,
  type Market,
  type MarketLinkOut,
  type Side,
} from "@/types";
import { formatAsOf, percentFromPrice } from "@/lib/format";
import { PantaBadge } from "./panta-badge";

interface TradeDeckProps {
  readonly market: Market;
  readonly readAt: AsOf;
  readonly provenance: DataProvenance;
}

/**
 * The buy CTA's gate (Phase 1: complete mediation). Connecting is an affordance
 * only — it grants no server privilege, and the server route that will
 * build/sign re-checks auth independently and fails closed. This component never
 * builds or signs anything: live signing stays disabled in preview.
 */
const TradeActionButton = ({ side }: { side: Side }) => {
  const { ready, authenticated, unavailable, login } = usePrivyGate();

  if (!authenticated) {
    const blocked = unavailable;
    return (
      <button
        type="button"
        disabled={!ready || blocked}
        aria-busy={!ready && !blocked}
        title={
          blocked
            ? "Wallet login is unavailable — this origin must be allowlisted in the Privy dashboard"
            : undefined
        }
        onClick={() => {
          if (ready) login();
        }}
        className="mt-5 w-full rounded-full bg-[#2D1C00] py-3 text-sm font-semibold tracking-tight text-[#FFF2DD] transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98] motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
      >
        {blocked
          ? "Login unavailable"
          : `Connect to back ${side === "yes" ? "YES" : "NO"}`}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title="Live signing lands with the trading backend"
      className="mt-5 w-full cursor-not-allowed rounded-full bg-[#2D1C00]/15 py-3 text-sm font-semibold tracking-tight text-[#2D1C00]/50"
    >
      Sign with wallet
    </button>
  );
};

/**
 * The trading surface — one client island. Owns the side selection shared by
 * the odds board and the buy slip (Phase 3: if they ever split into separate
 * islands, selection desyncs; the single useState is the closing construct).
 *
 * Phase guard (types/market::requirePrimaryMarket): the ONLY path to buy
 * controls. A non-primary market renders the link-out band; the slip below
 * additionally guards internally, so no composition can reach buy controls
 * for a graduated/resolved/cancelled market (Phase 3: buy-control bypass).
 */
export const TradeDeck = ({ market, readAt, provenance }: TradeDeckProps) => {
  const [side, setSide] = useState<Side>("yes");
  const guard = requirePrimaryMarket(market);

  if (!guard.ok) {
    return <GraduatedBand linkOut={guard.error} readAt={readAt} />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start lg:gap-8">
      <OddsBoard
        market={guard.value}
        readAt={readAt}
        provenance={provenance}
        side={side}
        onSelectSide={setSide}
      />
      <div className="lg:sticky lg:top-28">
        <BuySlip
          market={guard.value}
          readAt={readAt}
          provenance={provenance}
          side={side}
          onSelectSide={setSide}
        />
      </div>
    </div>
  );
};

/**
 * The board — a dark slab showing the YES/NO spread. The two halves are the
 * side selector for the slip (aria-pressed, one button per side, no nested
 * interactive elements). Every price is a DisplayPrice: asOf + provenance
 * render beneath, so fixture data is never presented as live.
 */
const OddsBoard = ({
  market,
  readAt,
  provenance,
  side,
  onSelectSide,
}: {
  market: Market;
  readAt: AsOf;
  provenance: DataProvenance;
  side: Side;
  onSelectSide: (side: Side) => void;
}) => {
  const yes = market.yesPrice
    ? displayPrice(market.yesPrice, readAt, provenance)
    : null;
  const no = market.noPrice
    ? displayPrice(market.noPrice, readAt, provenance)
    : null;
  // Layout-only widths, converted from the validated percent string; never
  // fed back into any domain call.
  const yesPct = yes ? parseFloat(percentFromPrice(yes.amount)) : null;
  const noPct = no ? parseFloat(percentFromPrice(no.amount)) : null;

  return (
    <section
      aria-label="Current prices"
      className="overflow-hidden rounded-4xl bg-[#2D1C00] text-[#FFF2DD]"
    >
      <div className="flex items-center justify-between border-b border-[#FFF2DD]/10 px-5 py-3.5 md:px-8">
        <p className="font-mono text-[11px] font-medium text-[#FFF2DD]/45">
          Market board
        </p>
        <PantaBadge tone="dark" />
      </div>

      <div className="grid grid-cols-2">
        <SideButton
          side="yes"
          label="Yes"
          display={yes}
          selected={side === "yes"}
          onSelect={() => onSelectSide("yes")}
        />
        <SideButton
          side="no"
          label="No"
          display={no}
          selected={side === "no"}
          onSelect={() => onSelectSide("no")}
        />
      </div>

      {/* Proportion bar — hidden when a price is missing rather than
          fabricating a split (Phase 2: null-price degradation). */}
      {yesPct !== null && noPct !== null ? (
        <div
          aria-hidden="true"
          className="flex h-1.5 bg-[#FFF2DD]/10"
        >
          <div className="bg-[#FFF2DD]" style={{ width: `${yesPct}%` }} />
        </div>
      ) : null}

      <p className="px-5 pb-5 pt-3 font-mono text-[11px] tracking-tight text-[#FFF2DD]/40 md:px-8">
        as of {formatAsOf(readAt)} ·{" "}
        {provenance === "fixture" ? "preview data, not live" : "live"}
      </p>
    </section>
  );
};

const SideButton = ({
  label,
  display,
  selected,
  onSelect,
}: {
  side: Side;
  label: string;
  display: DisplayPrice | null;
  selected: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    onClick={onSelect}
    aria-pressed={selected}
    aria-label={`Select ${label} side`}
    className={`group relative cursor-pointer px-5 py-8 text-left transition-colors duration-150 motion-reduce:transition-none md:px-8 md:py-12 ${
      selected ? "bg-[#FFF2DD]/10" : "hover:bg-[#FFF2DD]/5"
    }`}
  >
    <span className="font-tusker-6700 text-[11px] font-semibold uppercase tracking-widest text-[#FFF2DD]/45">
      {label}
      {selected ? " · selected" : ""}
    </span>
    {display ? (
      <>
        <span className="mt-4 block font-tusker-9800 text-5xl leading-none tracking-tight text-[#FFF2DD] md:text-7xl">
          {percentFromPrice(display.amount)}
          <span className="ml-1 align-top text-2xl text-[#FFF2DD]/45 md:text-3xl">
            %
          </span>
        </span>
        <span className="mt-2 block font-mono text-sm tracking-tight text-[#FFF2DD]/60">
          ${display.amount} · per share
        </span>
      </>
    ) : (
      <span className="mt-2 block font-tusker-9800 text-5xl leading-none text-[#FFF2DD]/30 md:text-7xl">
        —
      </span>
    )}
    {/* <span
      aria-hidden="true"
      className={`absolute inset-x-0 bottom-0 h-0.5 bg-[#FFF2DD] transition-opacity duration-150 motion-reduce:transition-none ${
        selected ? "opacity-100" : "opacity-0 group-hover:opacity-40"
      }`}
    /> */}
  </button>
);

/**
 * The buy slip — receipt-styled: perforated top edge, mono money, dot-leader
 * rows. Preview structure only: NO quote, NO builder, NO signing; the CTA is
 * disabled and this component never constructs a transaction. The fee row is
 * the fixture estimate from feeDisclosure, shown above the CTA (Phase 3:
 * fee-disclosure ordering).
 */
const BuySlip = ({
  market,
  readAt,
  side,
  onSelectSide,
}: {
  market: Market;
  readAt: AsOf;
  provenance: DataProvenance;
  side: Side;
  onSelectSide: (side: Side) => void;
}) => {
  const [amount, setAmount] = useState("");

  // Independent phase guard: even if this component were ever composed onto
  // a non-primary market, it renders nothing (fail-closed deny).
  const guard = requirePrimaryMarket(market);
  if (!guard.ok) return null;

  // Perimeter validation: the amount is checked against the USDC schema
  // before it could ever feed a quote. Preview-only for now.
  const amountResult = usdcDecimalSchema.safeParse(amount);
  const amountInvalid = amount.length > 0 && !amountResult.success;

  const fee = feeDisclosure(
    "buy",
    "Panta buy fee (est.)",
    usdcDecimalSchema.parse("1.5"),
    readAt,
  );

  return (
    <section
      aria-label="Buy slip"
      className="relative rounded-2xl bg-[#2D1C00]/5 p-5 shadow-[0_1px_0_rgba(45,28,0,0.05)] md:p-6"
    >
      {/* Receipt cues: punched notches + a perforated seam across the top. */}
      {/* <span
        aria-hidden="true"
        className="absolute -top-1.5 left-5 size-3 rounded-full bg-[#FFF2DD]"
      />
      <span
        aria-hidden="true"
        className="absolute -top-1.5 right-5 size-3 rounded-full bg-[#FFF2DD]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-px left-4 right-4 border-t-2 border-dashed border-[#2D1C00]/20"
      />

      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#2D1C00]/50">
          Buy slip
        </p>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#2D1C00]/40">
          {provenance === "fixture" ? "preview data" : "live"}
        </span>
      </div> */}

      {/* Side selector — mirrors the board selection. */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {SIDES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSelectSide(s)}
            aria-pressed={side === s}
            className={`cursor-pointer rounded-full py-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] transition-colors duration-150 motion-reduce:transition-none ${
              side === s
                ? "bg-[#2D1C00] text-[#FFF2DD]"
                : "bg-[#2D1C00]/5 text-[#2D1C00]/60 hover:bg-[#2D1C00]/10"
            }`}
          >
            {s.toUpperCase()}
          </button>
        ))}
      </div>

      <label
        htmlFor="buy-amount"
        className="mt-5 block font-mono text-md font-medium tracking-tight text-[#2D1C00]/50"
      >
        Amount (USDC)
      </label>
      <input
        id="buy-amount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        aria-label="Amount in USDC"
        aria-invalid={amountInvalid || undefined}
        className="mt-2 w-full rounded-full bg-[#2D1C00]/5 px-4 py-3 font-tusker-6700 text-lg font-semibold tracking-tight text-[#2D1C00] placeholder:text-[#2D1C00]/35 outline-none ring-1 ring-[#2D1C00]/10 transition focus:ring-2 focus:ring-[#2D1C00]/30"
      />
      {amountInvalid && (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          Enter a USDC amount like 25 or 25.50.
        </p>
      )}

      {/* Estimate rows — placeholder dashes: real values come from a quote,
          and a fabricated estimate is never shown. */}
      <dl className="mt-5 space-y-2.5 border-t border-[#2D1C00]/10 pt-4 text-sm">
        <SlipRow label="Est. shares" value="—" />
        <SlipRow label="Avg price" value="—" />
        <SlipRow
          label={fee.label}
          value={`$${fee.amountUsdc}`}
          note={`fee as of ${formatAsOf(fee.shownAt)}`}
        />
      </dl>

      <TradeActionButton side={side} />
      <p className="mt-3 text-xs leading-relaxed tracking-tight text-[#2D1C00]/50">
        Connecting links your wallet. No transaction is built or signed in
        preview.
      </p>

      <div className="mt-4 flex items-center justify-between border-t border-[#2D1C00]/10 pt-3">
        <PantaBadge />
        <span className="font-mono text-[10px] tracking-tight text-[#2D1C00]/40">
          as of {formatAsOf(readAt)}
        </span>
      </div>
    </section>
  );
};

const SlipRow = ({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) => (
  <div className="flex items-baseline gap-2">
    <dt className="shrink-0 text-[#2D1C00]/60 font-medium">{label}</dt>
    <span
      aria-hidden="true"
      className="mb-1 min-w-4 flex-1 border-b border-dotted border-[#2D1C00]/25"
    />
    <dd className="text-right">
      <span className="font-mono font-medium text-[#2D1C00]">{value}</span>
      {note && (
        <span className="block font-mono text-[10px] text-[#2D1C00]/45">
          {note}
        </span>
      )}
    </dd>
  </div>
);

/** Non-primary markets are read-only here — show why and link out to Panta. */
const BAND_COPY: Record<
  MarketLinkOut["phase"],
  { headline: string; sub: string }
> = {
  secondary: {
    headline: "This market graduated.",
    sub: "Secondary trading isn't hosted here yet. Trade it directly on Panta.",
  },
  resolved: {
    headline: "This market resolved.",
    sub: "See the outcome and claim on Panta.",
  },
  cancelled: {
    headline: "This market was cancelled.",
    sub: "It is no longer tradable.",
  },
};

const GraduatedBand = ({
  linkOut,
  readAt,
}: {
  linkOut: MarketLinkOut;
  readAt: AsOf;
}) => {
  const copy = BAND_COPY[linkOut.phase];
  return (
    <section
      aria-label="Market state"
      className="rounded-[2rem] bg-[#2D1C00] px-6 py-10 text-[#FFF2DD] md:px-10 md:py-14"
    >
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.22em] text-[#FFF2DD]/45">
        Phase · {linkOut.phase}
      </p>
      <h2 className="mt-3 max-w-xl font-tusker-9800 text-3xl leading-[1.02] tracking-tight md:text-5xl">
        {copy.headline}
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed tracking-tight text-[#FFF2DD]/70">
        {copy.sub}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <a
          href="https://panta.market"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-[#FFF2DD] px-5 py-2.5 text-sm font-semibold tracking-tight text-[#2D1C00] transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98] motion-reduce:transition-none"
        >
          Trade on Panta
          <ArrowUpRightFromSquare className="size-3.5" strokeWidth={2.5} />
        </a>
        <PantaBadge tone="dark" />
      </div>
      <p className="mt-5 font-mono text-[11px] tracking-tight text-[#FFF2DD]/40">
        as of {formatAsOf(readAt)}
      </p>
    </section>
  );
};