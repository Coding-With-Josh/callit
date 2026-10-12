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
 */
export function percentFromPrice(price: Price): string {
  const [whole = "0", frac = ""] = price.split(".");
  const padded = `${frac}00`.slice(0, 2);
  const shiftedWhole = `${whole}${padded}`.replace(/^0+(?=\d)/, "");
  const rest = frac.slice(2).replace(/0+$/, "");
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