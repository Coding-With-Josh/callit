/**
 * format — pure display formatters.
 *
 * No money math here. Prices and volumes are decimal strings from the domain;
 * these helpers only reshape them for display (string manipulation, no floats).
 */
import type { AsOf, Price, UnixSeconds, UsdcDecimal } from "@/types";

/**
 * "0.62" -> "62"; "0.625" -> "62.5"; "1" -> "100"; "0.05" -> "5".
 * Purely string-based — shifts the decimal point two places right.
 *
 * The fractional percent is TRUNCATED to `maxFraction` digits (default 1).
 * `priceSchema` permits up to 9 decimals, so an uncapped price like
 * "0.623456789" would render "62.3456789" — a string long enough to overflow its
 * column at EVERY viewport width, not just narrow ones. The cap is the fix for
 * that overflow; it never rounds (pure string truncation), consistent with the
 * no-money-math rule at the top of this file.
 */
export function percentFromPrice(price: Price, maxFraction = 1): string {
  const [whole = "0", frac = ""] = price.split(".");
  const padded = `${frac}00`.slice(0, 2);
  const shiftedWhole = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  const digits = Math.max(0, Math.trunc(maxFraction));
  const rest = frac.slice(2, 2 + digits).replace(/0+$/, "");
  return rest ? `${shiftedWhole}.${rest}` : shiftedWhole;
}

/** ISO "as of" -> "14:32 UTC" for the price provenance line. */
export function formatAsOf(asOf: AsOf): string {
  const date = new Date(asOf);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

/** Unix seconds -> date-only string ("Oct 10, 2026") for facts rows. */
export function formatUnixDate(seconds: UnixSeconds): string {
  return new Date(seconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * "84210.5" -> "$84,210.50". Groups the integer part, pads/truncates the
 * fraction to two digits — all on the string, no float conversion, consistent
 * with the no-money-math rule at the top of this file.
 */
export function formatUsdc(usdc: UsdcDecimal): string {
  const [whole = "0", frac = ""] = usdc.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = `${frac}00`.slice(0, 2);
  return `$${grouped}.${cents}`;
}

/**
 * A USDC TOTAL condensed for a stat line: "$842.10", "$84.2K", "$1.2M", "$3.4B".
 *
 * Below 1,000 it defers to formatUsdc (exact, two decimals). At or above 1,000 it
 * truncates to one decimal inside the K/M/B unit, dropping a trailing ".0"
 * ("$142K", not "$142.0K"). Purely string + BigInt — no float, matching the
 * no-money-math rule at the top of this file.
 *
 * Scope: market VOLUME only (a read-only statistic). Never a fee, price, or
 * amount a user is charged or that gets signed — those keep exact formatUsdc
 * cents, because a compacted figure must never be mistaken for the real one.
 */
export function formatUsdcCompact(usdc: UsdcDecimal): string {
  const [whole = "0"] = usdc.split(".");
  // Digits-only per usdcDecimalSchema, so BigInt() cannot throw on a valid value.
  const value = BigInt(whole);
  if (value < BigInt(1000)) return formatUsdc(usdc);

  const unit =
    value < BigInt(1_000_000) ? "K" : value < BigInt(1_000_000_000) ? "M" : "B";
  const divisor =
    unit === "K"
      ? BigInt(1_000)
      : unit === "M"
        ? BigInt(1_000_000)
        : BigInt(1_000_000_000);

  const scaled = value / divisor; // integer part of the unit
  const tenth = (value % divisor) / (divisor / BigInt(10)); // first decimal, 0..9
  const groupedScaled = scaled.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return tenth === BigInt(0)
    ? `$${groupedScaled}${unit}`
    : `$${groupedScaled}.${tenth}${unit}`;
}

/**
 * A share Price IS a USDC decimal in [0, 1] ("0.03" = 3 cents), so the card
 * renders it as dollars ("$0.03"). Deliberate brand-boundary cast: the caller
 * is asserting the price should be read as a dollar decimal for display. No
 * floats involved — delegates to the pure string formatter.
 */
export function formatPriceUsdc(price: Price): string {
  return formatUsdc(price as unknown as UsdcDecimal);
}

/**
 * A base58 transaction signature for a receipt-style confirmation line:
 * the first and last 8 characters with an ellipsis ("3Jp9C1tK…HXhDD3F").
 * Pure string slicing — a short/odd signature is returned unchanged rather
 * than coerced, so this can never throw into a render.
 */
export function formatSignatureShort(signature: string): string {
  if (signature.length <= 20) return signature;
  return `${signature.slice(0, 8)}…${signature.slice(-8)}`;
}