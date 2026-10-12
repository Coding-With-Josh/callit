"use client";

import { ArrowUpRightFromSquare, Loader2 } from "lucide-react";
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
import {
  formatAsOf,
  formatPriceUsdc,
  formatSignatureShort,
  formatUsdc,
  percentFromPrice,
} from "@/lib/format";
import { useBuyOrder, type BuyOrderController, type BuyOrderStatus } from "./use-buy-order";
import { PantaBadge } from "./panta-badge";

interface TradeDeckProps {
  readonly market: Market;
  readonly readAt: AsOf;
  readonly provenance: DataProvenance;
}

/**
 * The buy CTA's gate (Phase 1: complete mediation). Connecting is an affordance
 * only — it grants no server privilege, and the server routes that quote/build
 * re-check the session and re-derive the wallet independently.
 *
 * Two steps, deliberately (Phase 3: fee disclosure before signing):
 *  1. `Review order` fetches a quote and prepares an unsigned transaction; the
 *     slip then shows the real shares/price/fee from that quote.
 *  2. `Sign & send` prompts the wallet, which SUBMITS the transaction; the order
 *     is then reported to Panta.
 * The second step is the one that spends, and no control offers it twice: once
 * the wallet has sent, the only pressable action left is an idempotent report.
 */
const CTA_LABEL: Record<BuyOrderStatus, string> = {
  idle: "Review order",
  quoting: "Getting quote…",
  building: "Preparing order…",
  ready: "Sign & send",
  signing: "Confirm in your wallet…",
  unconfirmed: "Check your positions first",
  broadcast: "Submitting to Panta…",
  submitted: "Order placed ✓",
  reportFailed: "Report again",
  reportRefused: "Order placed, not recorded",
};

/**
 * One fixed sentence per state. The post-`ready` states describe a transaction
 * that is or may be ON-CHAIN, so none of them may claim the order did not
 * happen (Phase 3: false reassurance after money moved). `broadcast` and
 * `submitted` are kept apart so the copy only says Panta was told once it
 * actually was, and `reportRefused` exists so the terminal case does not offer a
 * retry that is known to fail.
 */
const statusNote = (status: BuyOrderStatus): string => {
  switch (status) {
    case "broadcast":
      return "Your wallet submitted the order — it is on-chain and may already have filled. This slip will not send it again.";
    case "submitted":
      return "Order placed. Your wallet submitted it and Panta has recorded it.";
    case "reportFailed":
      return "Your order was submitted on-chain, but Panta has not recorded it yet. Reporting again re-sends the same order and cannot place a second one.";
    case "reportRefused":
      return "Your wallet submitted the order, but Panta refused to record it — the quote it was built from had expired. The order is on-chain: check your positions before buying again. Change the amount to start a new order.";
    case "unconfirmed":
      return "We couldn't confirm whether your wallet submitted the order. Check your positions before buying again — an order may already have been placed.";
    default:
      return "Review fetches a live quote from Panta and prepares the order. Nothing is charged until you approve the transaction in your wallet — and approving it is also what submits it.";
  }
};

/** True while a quote/build/sign/report request is in flight (inputs frozen). */
const isBuyBusy = (status: BuyOrderStatus): boolean =>
  status === "quoting" ||
  status === "building" ||
  status === "signing" ||
  status === "broadcast";

const BuyCta = ({
  side,
  amountValid,
  buy,
  onPrepare,
}: {
  side: Side;
  amountValid: boolean;
  buy: BuyOrderController;
  onPrepare: () => void;
}) => {
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

  const busy = isBuyBusy(buy.status);
  const canConfirm = buy.status === "ready";
  const canReport = buy.status === "reportFailed";
  // Once the wallet has sent, nothing may be pressable again: a re-sign would
  // place a SECOND order (Phase 3: double spend by re-sign). `unconfirmed` is in
  // this set because we cannot rule out that the order already landed.
  const settled =
    buy.status === "signing" ||
    buy.status === "unconfirmed" ||
    buy.status === "broadcast" ||
    buy.status === "submitted" ||
    // A refusal retrying cannot fix: offering the button again would invite a
    // press that is known to fail while the order may already have moved money.
    buy.status === "reportRefused";
  const disabled = busy || settled || !amountValid || !ready;

  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={busy}
      onClick={() => {
        if (canConfirm) void buy.confirm();
        else if (canReport) void buy.report();
        else onPrepare();
      }}
      className={`mt-5 flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold tracking-tight transition-transform duration-150 motion-reduce:transition-none ${
        disabled
          ? "cursor-not-allowed bg-[#2D1C00]/15 text-[#2D1C00]/50"
          : "bg-[#2D1C00] text-[#FFF2DD] hover:scale-[1.02] active:scale-[0.98]"
      }`}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {CTA_LABEL[buy.status]}
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
 * rows. Two-step: `Review order` runs the quote/build/assemble pipeline (via
 * useBuyOrder) and fills in the real shares/price/fee; `Sign with wallet` then
 * signs the prepared bytes. Nothing is submitted or broadcast.
 *
 * The amount is validated at the perimeter (usdcDecimalSchema) before it can
 * reach a quote. The fee row shows Panta's real quote fee once prepared and a
 * dash before — a fabricated estimate is never displayed (Phase 3:
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
  const buy = useBuyOrder();

  // Independent phase guard: even if this component were ever composed onto
  // a non-primary market, it renders nothing (fail-closed deny).
  const guard = requirePrimaryMarket(market);
  if (!guard.ok) return null;
  const primary = guard.value;

  // Perimeter validation: the amount is checked against the USDC schema before
  // it can feed a quote or enable the CTA.
  const amountResult = usdcDecimalSchema.safeParse(amount);
  const amountInvalid = amount.length > 0 && !amountResult.success;
  const busy = isBuyBusy(buy.status);

  // The fee comes from the real quote once one exists; before that there is no
  // number to show (a fabricated estimate is never displayed).
  const fee = buy.quote
    ? feeDisclosure("buy", "Panta buy fee", buy.quote.feeUsdc, readAt)
    : null;

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

      {/* Side selector — mirrors the board selection. Frozen while a request
          is in flight so a switch cannot race an in-flight quote. */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {SIDES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => {
              onSelectSide(s);
              buy.reset();
            }}
            aria-pressed={side === s}
            className={`cursor-pointer rounded-full py-2 font-mono text-xs font-semibold uppercase tracking-[0.18em] transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60 ${
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
        disabled={busy}
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          // A prepared/submitted order belongs to the old amount; drop it so the
          // CTA never acts on bytes that no longer match the field. Non-idle
          // includes the post-send states, which is the user's only way back to
          // a fresh order after an ambiguous send.
          if (buy.status !== "idle") buy.reset();
        }}
        placeholder="0.00"
        aria-label="Amount in USDC"
        aria-invalid={amountInvalid || undefined}
        className="mt-2 w-full rounded-full bg-[#2D1C00]/5 px-4 py-3 font-tusker-6700 text-lg font-semibold tracking-tight text-[#2D1C00] placeholder:text-[#2D1C00]/35 outline-none ring-1 ring-[#2D1C00]/10 transition focus:ring-2 focus:ring-[#2D1C00]/30 disabled:opacity-60"
      />
      {amountInvalid && (
        <p className="mt-2 text-xs font-medium text-red-700" role="alert">
          Enter a USDC amount like 25 or 25.50.
        </p>
      )}

      {/* Estimate rows — real values from the quote once prepared; a fabricated
          estimate is never shown before the quote exists. */}
      <dl className="mt-5 space-y-2.5 border-t border-[#2D1C00]/10 pt-4 text-sm">
        <SlipRow label="Est. shares" value={buy.quote ? buy.quote.shares : "—"} />
        <SlipRow
          label="Avg price"
          value={buy.quote ? formatPriceUsdc(buy.quote.avgPrice) : "—"}
        />
        <SlipRow
          label="Panta buy fee"
          value={fee ? formatUsdc(fee.amountUsdc) : "—"}
          note={fee ? `as of ${formatAsOf(fee.shownAt)}` : undefined}
        />
      </dl>

      <BuyCta
        side={side}
        amountValid={amountResult.success}
        buy={buy}
        onPrepare={() => void buy.prepare(primary.marketId, side, amount)}
      />

      {buy.error && (
        <p
          role="alert"
          className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium leading-relaxed text-red-800 ring-1 ring-red-200"
        >
          {buy.error}
        </p>
      )}

      {(buy.status === "broadcast" ||
        buy.status === "submitted" ||
        buy.status === "reportFailed" ||
        buy.status === "reportRefused") &&
        buy.signature && (
          <p className="mt-3 font-mono text-[11px] leading-relaxed tracking-tight text-[#2D1C00]/70">
            Submitted {formatSignatureShort(buy.signature)}
          </p>
        )}

      <p className="mt-3 text-xs leading-relaxed tracking-tight text-[#2D1C00]/50">
        {statusNote(buy.status)}
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